/** Exact-output acceptance for trusted task producers; not a general semantic judge. */
import { createHash } from 'node:crypto'
import { win32, posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { MessageId, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
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

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Open-turn task acceptance facts read instead of Session history. */
    taskAcceptanceTurn: TaskAcceptanceTurnState
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

const taskAcceptanceTurnStateSchema = zod.object({
  turn: zod.number().nullable(),
  /** True between `turn/start` and `turn/end`. */
  open: zod.boolean(),
  /** Direct-human messages admitted in the open turn. */
  userMessages: zod.number(),
  /** The latest direct-human message carrying acceptance criteria. */
  task: zod.object({ id: zod.string(), acceptance: zod.unknown() }).nullable(),
  /** Some direct-human message of the open turn requested read-only work. */
  readOnly: zod.boolean(),
  lastResponse: zod.object({ id: zod.string(), text: zod.string() }).nullable(),
  validations: zod.array(zod.object({ messageId: zod.string(), responseId: zod.string(), status: zod.string() })),
  /** `read` calls of the open turn with their requested path. */
  readCalls: zod.array(zod.object({ callId: zod.string(), filePath: zod.string() })),
  /** Read calls whose result was not an error. */
  successfulReads: zod.array(zod.string()),
})

/** Folded open-turn acceptance facts. */
type TaskAcceptanceTurnState = zod.infer<typeof taskAcceptanceTurnStateSchema>

const EMPTY_ACCEPTANCE_STATE: TaskAcceptanceTurnState = {
  turn: null, open: false, userMessages: 0, task: null, readOnly: false, lastResponse: null,
  validations: [], readCalls: [], successfulReads: [],
}

/** The requested path of one `read` call, or undefined for invalid model JSON. */
function readPath(argumentsText: string): string | undefined {
  let args: unknown
  try { args = JSON.parse(argumentsText) }
  catch { return undefined /* Invalid model JSON cannot establish a successful read. */ }
  return args !== null && typeof args === 'object' && 'file_path' in args && typeof args.file_path === 'string'
    ? args.file_path
    : undefined
}

/**
 * Pure fold of the open turn; returns the same reference for events it does not need.
 * @param state - facts covering all prior events.
 * @param event - the next committed Session event.
 * @returns the next facts.
 */
function applyAcceptanceEvent(state: TaskAcceptanceTurnState, event: SessionEvent): TaskAcceptanceTurnState {
  switch (event.type) {
    case 'turn/start':
      return { ...EMPTY_ACCEPTANCE_STATE, turn: event.data.turn, open: true }
    case 'turn/end':
      return state.open ? { ...state, open: false } : state
    case 'user/message': {
      if (!state.open || event.data.source.kind !== 'user') return state
      const acceptance = 'acceptance' in event.data.source ? event.data.source.acceptance : undefined
      return {
        ...state,
        userMessages: state.userMessages + 1,
        ...acceptance === undefined ? {} : { task: { id: String(event.data.id), acceptance } },
        readOnly: state.readOnly || acceptance?.readOnly === true,
      }
    }
    case 'assistant/message':
      if (!state.open) return state
      return {
        ...state,
        lastResponse: {
          id: String(event.data.message.id),
          text: event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
        },
      }
    case 'task/validation':
      if (!state.open) return state
      return {
        ...state,
        validations: [...state.validations,
          { messageId: String(event.data.messageId), responseId: String(event.data.responseId), status: event.data.status }],
      }
    case 'tool/call': {
      if (!state.open || event.data.name !== 'read') return state
      const filePath = readPath(event.data.arguments)
      return filePath === undefined ? state : { ...state, readCalls: [...state.readCalls, { callId: String(event.data.callId), filePath }] }
    }
    case 'tool/result': {
      const callId = String(event.data.message.toolCallId)
      if (!state.open || event.data.message.isError === true || !state.readCalls.some(call => call.callId === callId)) return state
      return { ...state, successfulReads: [...state.successfulReads, callId] }
    }
    default:
      return state
  }
}

/** Projection registered with the acceptance policy. */
const taskAcceptanceTurnDefinition = {
  key: 'taskAcceptanceTurn',
  stateVersion: 1,
  stateSchema: taskAcceptanceTurnStateSchema,
  init: (): TaskAcceptanceTurnState => EMPTY_ACCEPTANCE_STATE,
  apply: applyAcceptanceEvent,
} as const

/**
 * Install same-turn acceptance; correction counts come only from durable decisions.
 * @param ctx - Plugin context owning the acceptance service and guards.
 */
export function installTaskAcceptance(ctx: Context): void {
  ctx.provide('taskAcceptance', { create: createAcceptanceTask })
  ctx.sessionProjections.register(taskAcceptanceTurnDefinition)
  ctx.tools.guard((exec: Readonly<ToolExecution>) => {
    if (exec.agent === undefined) return undefined
    const state = ctx.sessionProjections.stateOf(exec.agent.session, 'taskAcceptanceTurn')
    if (state === undefined || !state.open || !state.readOnly) return undefined
    // Closed allowlist: shells, delegation and unknown tools cannot bypass read-only intent.
    if (exec.name === 'read' || exec.name === 'glob' || exec.name === 'grep') return undefined
    return 'Esta tarefa permite somente leitura: use read, glob ou grep. Não execute alterações, terminal ou delegação.'
  })
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'taskAcceptanceTurn')
    if (state === undefined || state.turn !== turn || state.task === null) return
    const task = state.task
    // Combining independent user requests has no single exact-output answer.
    if (state.userMessages !== 1) throw new HarnessError('Validated task received another user request in the same turn.', 'TASK_ACCEPTANCE_AMBIGUOUS')
    const criteria = task.acceptance
    validate(criteria)
    const response = state.lastResponse
    if (response === null) {
      throw new HarnessError('Validated task has no final response.', 'TASK_ACCEPTANCE_UNSATISFIED')
    }
    const prior = state.validations.filter(validation => validation.messageId === task.id)
    const duplicate = prior.find(validation => validation.responseId === response.id)
    if (duplicate !== undefined) {
      if (duplicate.status === 'passed') return
      throw new HarnessError('Task acceptance decision cannot be repeated without a new response.', 'TASK_ACCEPTANCE_UNSATISFIED')
    }
    const text = response.text
    const required = criteria.requiredReadPath
    const readOk = required === undefined || state.readCalls.some(call =>
      pathKey(call.filePath) === pathKey(required) && state.successfulReads.includes(call.callId))
    const functional = criteria.arithmeticTests === undefined ? undefined : checkArithmetic(text, criteria.arithmeticTests)
    const answerOk = functional?.passed ?? (digest(text) === criteria.expectedSha256)
    const reason = !answerOk ? 'output-mismatch' : !readOk ? 'read-missing' : 'matched'
    const status = reason === 'matched' ? 'passed' : prior.length < criteria.maxRecoveries ? 'retry' : 'failed'
    agent.session.append('task/validation', {
      messageId: MessageId(task.id), responseId: MessageId(response.id), turn,
      attempt: prior.length + 1, status, reason,
    })
    if (status === 'passed') return
    if (status === 'failed') throw new HarnessError('Task failed its explicit acceptance criteria.', 'TASK_ACCEPTANCE_UNSATISFIED')
    if (functional !== undefined) {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `A resposta não passou na validação desta tarefa. Resultado dos testes: ${functional.evidence}${readOk ? '' : ' A leitura obrigatória do arquivo ainda não foi comprovada.'} Corrija o problema observado e devolva somente a linha return completa. Não altere arquivos.` }],
        source: { kind: 'completion-claim-policy', form: 'notice', summary: `Task acceptance recovery ${prior.length + 1}/${criteria.maxRecoveries}` },
      }))
      return
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'A resposta não passou na validação objetiva desta tarefa. Releia o pedido atual e, se necessário, o arquivo indicado nele. Confira o conteúdo e o formato solicitados. Responda com o valor integral solicitado, sem herdar limites de formato de tarefas anteriores. Se o pedido exigir apenas o valor, não acrescente introdução, explicação, rótulos, negrito ou cercas de código. Preserve a unidade completa pedida: uma linha de código não é apenas sua expressão. Use JSON ou outro formato quando o pedido o exigir. Não altere arquivos para satisfazer a validação.' }],
      source: { kind: 'completion-claim-policy', form: 'notice', summary: `Task acceptance recovery ${prior.length + 1}/${criteria.maxRecoveries}` },
    }))
  })
}
