/** Exact-output acceptance for trusted task producers; not a general semantic judge. */
import { createHash } from 'node:crypto'
import { win32, posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import { checkArithmetic, isArithmeticTests, type ArithmeticTest } from './arithmetic-validation.ts'

/** Persisted criteria supplied by a trusted task producer, never inferred from tool output. */
export interface ExactTaskAcceptance {
  version: 1
  expectedSha256?: string
  arithmeticTests?: ArithmeticTest[]
  maxRecoveries: number
  requiredReadPath?: string
  readOnly?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Available only while the owning acceptance policy is mounted in this scope. */
    taskAcceptance: { create: typeof createAcceptanceTask }
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'accepted-task': { kind: 'user'; acceptance: ExactTaskAcceptance }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact-output decision; does not assert general correctness or retract streamed text. */
    'task/validation': {
      messageId: MessageId
      responseId: MessageId
      turn: number
      attempt: number
      status: 'passed' | 'retry' | 'failed'
      reason: 'matched' | 'output-mismatch' | 'read-missing'
    }
  }
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function validate(criteria: unknown): asserts criteria is ExactTaskAcceptance {
  if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)
    || !('version' in criteria) || criteria.version !== 1
    || (('expectedSha256' in criteria) === ('arithmeticTests' in criteria))
    || ('expectedSha256' in criteria && (typeof criteria.expectedSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(criteria.expectedSha256)))
    || ('arithmeticTests' in criteria && (!isArithmeticTests(criteria.arithmeticTests)
      || !('readOnly' in criteria) || criteria.readOnly !== true))
    || !('maxRecoveries' in criteria) || typeof criteria.maxRecoveries !== 'number'
    || !Number.isInteger(criteria.maxRecoveries) || criteria.maxRecoveries < 0 || criteria.maxRecoveries > 3
    || ('readOnly' in criteria && typeof criteria.readOnly !== 'boolean')
    || ('requiredReadPath' in criteria
      && (typeof criteria.requiredReadPath !== 'string'
        || !(win32.isAbsolute(criteria.requiredReadPath) || posix.isAbsolute(criteria.requiredReadPath))))) {
    throw new HarnessError('Invalid persisted task acceptance criteria.', 'TASK_ACCEPTANCE_INVALID')
  }
}

/**
 * Create a task with durable exact-output criteria for a mounted completion policy.
 * Do not use secrets: hashes of low-entropy expected answers are guessable.
 * @param content Task instructions; expected output is not automatically included.
 * @param expectedText Exact UTF-8 answer, or undefined when arithmetic tests are supplied instead.
 * @param options Recovery allowance, optional required read, read-only execution, and numeric test vectors.
 * @returns Identified user message to submit through the normal agent inbox.
 */
export function createAcceptanceTask(
  content: ContentBlock[],
  expectedText: string | undefined,
  options: { maxRecoveries: number; requiredReadPath?: string; readOnly?: boolean; arithmeticTests?: ArithmeticTest[] },
): UserMessage {
  const acceptance: ExactTaskAcceptance = {
    version: 1, ...expectedText === undefined ? {} : { expectedSha256: digest(expectedText) }, ...options,
  }
  validate(acceptance)
  return createUserMessage({ content, source: { kind: 'user', acceptance } })
}

function pathKey(path: string): string {
  return win32.isAbsolute(path) && !posix.isAbsolute(path)
    ? win32.normalize(path).toLowerCase()
    : posix.normalize(path)
}

/**
 * Install same-turn acceptance; correction counts come only from durable decisions.
 * @param ctx - Plugin context owning the acceptance service and guards.
 */
export function installTaskAcceptance(ctx: Context): void {
  ctx.provide('taskAcceptance', { create: createAcceptanceTask })
  ctx.tools.guard((exec: Readonly<ToolExecution>) => {
    if (exec.agent === undefined) return undefined
    const events = exec.agent.session.events
    const start = events.findLastIndex(e => e.type === 'turn/start')
    if (start < 0) return undefined
    const tail = events.slice(start + 1)
    if (tail.some(e => e.type === 'turn/end')) return undefined
    const restricted = tail.some(e => e.type === 'user/message' && e.data.source.kind === 'user'
      && 'acceptance' in e.data.source && e.data.source.acceptance.readOnly === true)
    if (!restricted) return undefined
    // Closed allowlist: shells, delegation and unknown tools cannot bypass read-only intent.
    if (exec.name === 'read' || exec.name === 'glob' || exec.name === 'grep') return undefined
    return 'Esta tarefa permite somente leitura: use read, glob ou grep. Não execute alterações, terminal ou delegação.'
  })
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const start = agent.session.events.findLastIndex(e => e.type === 'turn/start' && e.data.turn === turn)
    if (start < 0) return
    const tail = agent.session.events.slice(start + 1)
    const tasks = tail.filter(e => e.type === 'user/message' && e.data.source.kind === 'user')
    const task = tasks.findLast(e => e.type === 'user/message' && 'acceptance' in e.data.source)
    if (task === undefined || task.type !== 'user/message' || !('acceptance' in task.data.source)) return
    // Combining independent user requests has no single exact-output answer.
    if (tasks.length !== 1) throw new HarnessError('Validated task received another user request in the same turn.', 'TASK_ACCEPTANCE_AMBIGUOUS')
    const criteria = task.data.source.acceptance
    validate(criteria)
    const response = tail.findLast(e => e.type === 'assistant/message')
    if (response === undefined) {
      throw new HarnessError('Validated task has no final response.', 'TASK_ACCEPTANCE_UNSATISFIED')
    }
    const prior = tail.filter(e => e.type === 'task/validation' && e.data.messageId === task.data.id)
    const duplicate = prior.find(e => e.type === 'task/validation' && e.data.responseId === response.data.message.id)
    if (duplicate !== undefined && duplicate.type === 'task/validation') {
      if (duplicate.data.status === 'passed') return
      throw new HarnessError('Task acceptance decision cannot be repeated without a new response.', 'TASK_ACCEPTANCE_UNSATISFIED')
    }
    const text = response.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    const reads = new Set<string>()
    if (criteria.requiredReadPath !== undefined) {
      for (const event of tail) {
        if (event.type !== 'tool/call' || event.data.name !== 'read') continue
        let args: unknown
        try { args = JSON.parse(event.data.arguments) }
        catch { continue /* Invalid model JSON cannot establish a successful read. */ }
        if (args !== null && typeof args === 'object' && 'file_path' in args
          && typeof args.file_path === 'string' && pathKey(args.file_path) === pathKey(criteria.requiredReadPath)) {
          reads.add(event.data.callId)
        }
      }
    }
    const readOk = criteria.requiredReadPath === undefined || tail.some(e => e.type === 'tool/result'
      && reads.has(e.data.message.source.callId) && e.data.message.content[0].isError !== true)
    const functional = criteria.arithmeticTests === undefined ? undefined : checkArithmetic(text, criteria.arithmeticTests)
    const answerOk = functional?.passed ?? (digest(text) === criteria.expectedSha256)
    const reason = !answerOk ? 'output-mismatch' : !readOk ? 'read-missing' : 'matched'
    const status = reason === 'matched' ? 'passed' : prior.length < criteria.maxRecoveries ? 'retry' : 'failed'
    agent.session.append('task/validation', {
      messageId: task.data.id, responseId: response.data.message.id, turn,
      attempt: prior.length + 1, status, reason,
    })
    if (status === 'passed') return
    if (status === 'failed') throw new HarnessError('Task failed its explicit acceptance criteria.', 'TASK_ACCEPTANCE_UNSATISFIED')
    if (functional !== undefined) {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `A resposta não passou na validação desta tarefa. Resultado dos testes: ${functional.evidence}${readOk ? '' : ' A leitura obrigatória do arquivo ainda não foi comprovada.'} Corrija o problema observado e devolva somente a linha return completa. Não altere arquivos.` }],
        source: { kind: 'plugin', plugin: 'completion-claim-policy', form: 'evidence-recovery', summary: `Task acceptance recovery ${prior.length + 1}/${criteria.maxRecoveries}` },
      }))
      return
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'A resposta não passou na validação objetiva desta tarefa. Releia o pedido atual e, se necessário, o arquivo indicado nele. Confira o conteúdo e o formato solicitados. Responda com o valor integral solicitado, sem herdar limites de formato de tarefas anteriores. Se o pedido exigir apenas o valor, não acrescente introdução, explicação, rótulos, negrito ou cercas de código. Preserve a unidade completa pedida: uma linha de código não é apenas sua expressão. Use JSON ou outro formato quando o pedido o exigir. Não altere arquivos para satisfazer a validação.' }],
      source: { kind: 'plugin', plugin: 'completion-claim-policy', form: 'evidence-recovery', summary: `Task acceptance recovery ${prior.length + 1}/${criteria.maxRecoveries}` },
    }))
  })
}
