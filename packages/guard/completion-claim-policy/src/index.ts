/**
 * Evidence policy for strong global completion claims. The plugin reconstructs
 * only the open turn's durable event tail and either permits an evidenced claim,
 * steers one bounded correction, or rejects a repeated unsupported claim.
 * @module @deepseek-ai/dsh-completion-claim-policy
 */

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { installTaskAcceptance } from './task-acceptance.ts'
export { createAcceptanceTask } from './task-acceptance.ts'
export type { ExactTaskAcceptance } from './task-acceptance.ts'

/** Durable provenance of one bounded evidence-correction message. */
export interface CompletionEvidenceSource {
  kind: 'plugin'
  plugin: 'completion-claim-policy'
  form: 'evidence-recovery'
  summary: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'completion-evidence-recovery': CompletionEvidenceSource
  }
}

/** Cordis plugin name used in configuration and durable message provenance. */
export const name = 'completion-claim-policy'

/** The executor guard must exist before accepting restricted tasks. */
export const inject = ['tools']

/** Stable machine-routable code for a repeated unsupported global completion claim. */
export const COMPLETION_EVIDENCE_UNSATISFIED = 'COMPLETION_EVIDENCE_UNSATISFIED'

/** Deployment policy for evidence recovery at the final turn boundary. */
export interface Config {
  /** Same-turn corrections allowed before the policy rejects the claim (default 0, maximum 3). */
  maxEvidenceRecoveries?: number
  /** Maximum UTF-8 bytes retained in one recovery message (default 4096). */
  maxRecoveryMessageBytes?: number
  /** Maximum quoted absolute artifact paths checked per claim (default 32). */
  maxArtifactClaims?: number
  /** Verify absolute Windows paths quoted in backticks by the final claim (default false). */
  verifyAbsoluteArtifactClaims?: boolean
  /** Require at least one successful tool result in the current turn (default false). */
  requireCurrentTurnEvidence?: boolean
}

/** Loader schema; bounded integer validation is repeated at plugin load for direct callers. */
export const Config: z<Config> = z.object({
  maxEvidenceRecoveries: z.number().step(1).min(0).max(3).default(0),
  maxRecoveryMessageBytes: z.number().step(1).min(512).max(65_536).default(4096),
  maxArtifactClaims: z.number().step(1).min(1).max(256).default(32),
  verifyAbsoluteArtifactClaims: z.boolean().default(false),
  requireCurrentTurnEvidence: z.boolean().default(false),
})

const MAX_EVIDENCE_RECOVERIES = 3
const MIN_RECOVERY_MESSAGE_BYTES = 512
const MAX_RECOVERY_MESSAGE_BYTES = 65_536
const DEFAULT_RECOVERY_MESSAGE_BYTES = 4096
const MAX_ARTIFACT_CLAIMS = 256
const DEFAULT_MAX_ARTIFACT_CLAIMS = 32
const RECOVERY_FORM = 'evidence-recovery'
const RECOVERY_SUMMARY = 'Completion evidence recovery '
const RECOVERY_HEADER = 'A alegação global de conclusão não está sustentada pelo registro deste turno:'
const RECOVERY_INSTRUCTION = 'Continue e produza/verifique as evidências faltantes, atualize as tarefas, ou responda honestamente que o resultado é parcial ou está bloqueado. '
  + 'Não declare que tudo está funcionando, 100% concluído ou plenamente operacional enquanto qualquer lacuna permanecer.'
const RECOVERY_TRUNCATION = '- detalhes adicionais truncados para respeitar o limite configurado'
const COMPLETION_EVIDENCE_ERROR_MESSAGE = 'Strong global completion claim remains unsupported after bounded evidence recovery.'

/** Normalize case and accents without changing word boundaries. */
function normalizedClaimText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Global subjects and predicates stay adjacent; no pattern crosses a clause. */
const GLOBAL_COMPLETION_PATTERNS = [
  new RegExp(
    String.raw`\btudo\s+(?:funciona|(?:esta|foi)\s+(?:(?:100\s*%|totalmente|completamente|plenamente)\s+)?`
    + String.raw`(?:funcionando|funcional|operacional|concluido|completo|validado|verificado))\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:esta\s+)?tudo\s+(?:(?:100\s*%|totalmente|completamente|plenamente)\s+)?`
    + String.raw`(?:funcionando|funcional|operacional|concluido|completo|validado|verificado)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:todas\s+as|todos\s+os)\s+(?:ferramentas|habilidades|capacidades|funcoes|funcionalidades)`
    + String.raw`(?:\s+e\s+(?:ferramentas|habilidades|capacidades|funcoes|funcionalidades))*\s+`
    + String.raw`(?:funcionam|(?:(?:estao|foram)\s+)?(?:(?:100\s*%|totalmente|completamente|plenamente)\s+)?`
    + String.raw`(?:funcionando|funciona(?:l|is)|operaciona(?:l|is)|concluid[oa]s?|complet[oa]s?|validad[oa]s?|verificad[oa]s?))\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:leon|o\s+sistema|todo\s+o\s+sistema|o\s+sistema\s+inteiro|sistema\s+inteiro)\s+`
    + String.raw`(?:funciona|(?:(?:esta|foi)\s+)?(?:(?:100\s*%|totalmente|completamente|plenamente)\s+)?`
    + String.raw`(?:funcionando|funcional|operacional|concluido|completo|validado|verificado))\b`,
    'u',
  ),
  /\b(?:leon|o\s+sistema|todo\s+o\s+sistema|o\s+sistema\s+inteiro|sistema\s+inteiro)\s+(?:esta\s+)?pronto\s+para\s+qualquer\s+tarefa\b/u,
  new RegExp(
    String.raw`\beverything\s+(?:works|(?:is|was)\s+(?:(?:100\s*%|fully)\s+)?`
    + String.raw`(?:working|functional|operational|complete|completed|verified|validated))\b`,
    'u',
  ),
  new RegExp(
    String.raw`\ball(?:\s+of)?\s+(?:the\s+)?(?:tools|skills|capabilities|features)`
    + String.raw`(?:\s+and\s+(?:tools|skills|capabilities|features))*\s+`
    + String.raw`(?:work|(?:(?:are|were)\s+)?(?:(?:100\s*%|fully)\s+)?`
    + String.raw`(?:working|functional|operational|complete|completed|verified|validated))\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:leon|the\s+system|the\s+entire\s+system|the\s+whole\s+system)\s+`
    + String.raw`(?:works|(?:(?:is|was)\s+)?(?:(?:100\s*%|fully)\s+)?`
    + String.raw`(?:working|functional|operational|complete|completed|verified|validated))\b`,
    'u',
  ),
  /\b(?:leon|the\s+system|the\s+entire\s+system|the\s+whole\s+system)\s+(?:is\s+)?ready\s+for\s+any\s+task\b/u,
] as const

const STANDALONE_GLOBAL_COMPLETION = new RegExp(
  String.raw`^(?:(?:resultado|result|status)\s*:\s*)?(?:100\s*%\s+`
  + String.raw`(?:operacional|funcional|funcionando|concluido|completo|validado|verificado|operational|functional|working|complete|completed|verified)|`
  + String.raw`(?:totalmente|completamente|plenamente)\s+operacional|fully\s+operational|`
  + String.raw`pront[oa]\s+para\s+qualquer\s+tarefa|ready\s+for\s+any\s+task)$`,
  'u',
)

/** A clause with these markers describes uncertainty, a condition, or quoted language. */
const NON_ASSERTIVE_MARKERS = new RegExp(
  String.raw`\b(?:se|caso|talvez|possivelmente|aparentemente|parece|parecem|verificando|checando|investigando|`
  + String.raw`if|unless|whether|maybe|perhaps|possibly|apparently|seems?|appears?|checking|verifying|investigating|`
  + String.raw`exemplo|frase|citacao|example|phrase|quotation)\b|`
  + String.raw`\b(?:preciso|precisamos|vou|vamos)\s+(?:verificar|checar|validar)\b|`
  + String.raw`\b(?:need\s+to|will)\s+(?:verify|check|validate)\b|`
  + String.raw`\b(?:evite\s+dizer|avoid\s+saying|do\s+not\s+say|don't\s+say)\b`,
  'u',
)

/** Negation is evaluated per clause so it cannot hide a later positive claim. */
const NEGATION_MARKERS = new RegExp(
  String.raw`\b(?:nao|nem|nunca|jamais|not|never|cannot|can['’]?t|isn['’]?t|aren['’]?t|`
  + String.raw`wasn['’]?t|weren['’]?t|doesn['’]?t|don['’]?t|didn['’]?t|won['’]?t)\b`,
  'u',
)

/** Qualifiers that make an otherwise broad grammatical subject local. */
const LOCAL_SCOPE_MARKERS = new RegExp(
  String.raw`\b(?:apenas|somente|only)\b|`
  + String.raw`\b(?:no|na|nos|nas|neste|nesta|nesse|nessa|dentro\s+do|dentro\s+da)\s+`
  + String.raw`(?:navegador|browser|windows|etapa|fase|relatorio|documento|teste|modulo|componente|ambiente|projeto|workspace|producao|staging)\b|`
  + String.raw`\b(?:in|on|for|within)\s+(?:the\s+)?(?:browser|windows|phase|stage|report|document|test|module|component|environment|project|workspace|production|staging)\b`,
  'u',
)

/** Explicit caveats after a claim make that sentence partial rather than global. */
const LIMITATION_MARKERS = new RegExp(
  String.raw`\b(?:exceto|parcial|pendente|pendentes|bloqueado|bloqueada|incompleto|incompleta|falha|falhas|falta|faltam|resta|restam|`
  + String.raw`except|partial|pending|blocked|incomplete|failure|failures|failed|missing|remains?|untested)\b|`
  + String.raw`\b(?:nao\s+(?:foi|foram|esta|estao)?\s*(?:testad[oa]s?|validad[oa]s?|concluid[oa]s?|funcionando|operacional|pront[oa])|`
  + String.raw`not\s+(?:tested|validated|completed|working|operational|ready))\b`,
  'u',
)

/** Keep sentence punctuation so questions remain distinguishable from assertions. */
function completionSentences(value: string): string[] {
  return value.match(/[^.!?\r\n]+[.!?]?/gu)?.map(sentence => sentence.trim()).filter(Boolean) ?? []
}

/** Split only at explicit clause boundaries; the patterns themselves contain no free-form wildcard. */
function completionClauses(sentence: string): string[] {
  return sentence
    .split(/\s*(?:;|\b(?:mas|porem|contudo|entretanto|but|however|yet)\b|,\s*(?=(?:agora|now)\b))\s*/u)
    .map(clause => clause.trim())
    .filter(Boolean)
}

/** Whether one clause contains an affirmative, unscoped global claim. */
function clauseHasStrongGlobalClaim(clause: string): boolean {
  const semanticClause = clause.replace(/`[^`\r\n]*`/gu, '')
  if (semanticClause.includes('?')
    || /["“”]/u.test(semanticClause)
    || NEGATION_MARKERS.test(semanticClause)
    || NON_ASSERTIVE_MARKERS.test(semanticClause)
    || LOCAL_SCOPE_MARKERS.test(semanticClause)
    || LIMITATION_MARKERS.test(semanticClause)) return false
  const value = semanticClause.replace(/^[\s,.!:'"“”‘’()-]+|[\s,.!:'"“”‘’()-]+$/gu, '')
  return STANDALONE_GLOBAL_COMPLETION.test(value)
    || GLOBAL_COMPLETION_PATTERNS.some(pattern => pattern.test(value))
}

/**
 * Match only global, high-confidence claims. Generic statements such as
 * "auditoria concluída" and "analysis complete" deliberately do not match.
 *
 * @param text User-visible assistant text to classify.
 * @returns Whether the text contains a strong global completion claim.
 */
export function isStrongGlobalCompletionClaim(text: string): boolean {
  const value = normalizedClaimText(text).replace(/`[^`\r\n]*`/gu, ' ')
  for (const sentence of completionSentences(value)) {
    const clauses = completionClauses(sentence)
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index]
      if (clause === undefined || !clauseHasStrongGlobalClaim(clause)) continue
      if (clauses.slice(index + 1).some(candidate => LIMITATION_MARKERS.test(candidate))) continue
      return true
    }
  }
  return false
}

/** Concatenate user-visible text blocks without inspecting reasoning or tool calls. */
function visibleText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

interface ToolOutcome {
  failed: boolean
  detail?: string
}

interface ToolOperation {
  key: string
  name: string
}

interface EvidenceGaps {
  pendingTodos: number
  inProgressTodos: number
  callsWithoutResult: string[]
  failedTools: Array<{ name: string; detail?: string }>
  missingArtifacts: string[]
  artifactClaimLimitExceeded: boolean
  missingCurrentTurnEvidence: boolean
}

interface TurnEvidence {
  claim?: string
  recoveries: number
  gaps: EvidenceGaps
}

/** Stable identity for one tool name plus its exact durable argument payload. */
function toolOperation(name: string, argumentsText: string): ToolOperation {
  return { name, key: `${name}\u0000${argumentsText}` }
}

/** Find one non-zero or signalled terminal outcome inside an opaque JSON value. */
function terminalFailure(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const failure = terminalFailure(item)
      if (failure !== undefined) return failure
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  if (record.card === 'terminal') {
    if (typeof record.exitCode === 'number' && record.exitCode !== 0) return `exitCode ${record.exitCode}`
    if (typeof record.signal === 'string' && record.signal.length > 0) return `signal ${record.signal}`
  }
  const status = record.sessionStatus
  if (status !== null && typeof status === 'object' && !Array.isArray(status)) {
    const terminal = status as Record<string, unknown>
    if (terminal.kind === 'exited') {
      if (typeof terminal.exitCode === 'number' && terminal.exitCode !== 0) return `exitCode ${terminal.exitCode}`
      if (typeof terminal.signal === 'string' && terminal.signal.length > 0) return `signal ${terminal.signal}`
    }
  }
  for (const child of Object.values(record)) {
    const failure = terminalFailure(child)
    if (failure !== undefined) return failure
  }
  return undefined
}

interface ArtifactClaims {
  paths: string[]
  limitExceeded: boolean
}

/** Extract a bounded set of absolute Windows code-span paths. */
function absoluteArtifactClaims(text: string, maxClaims: number): ArtifactClaims {
  const paths = new Set<string>()
  for (const match of text.matchAll(/`([a-z]:[\\/][^`\r\n]+)`/giu)) {
    const path = match[1]?.trim()
    if (path === undefined || path.length <= 3 || paths.has(path)) continue
    if (paths.size >= maxClaims) return { paths: [...paths], limitExceeded: true }
    paths.add(path)
  }
  return { paths: [...paths], limitExceeded: false }
}

/** Whether any evidence gap prevents a global completion claim. */
function hasGaps(gaps: EvidenceGaps): boolean {
  return gaps.pendingTodos > 0
    || gaps.inProgressTodos > 0
    || gaps.callsWithoutResult.length > 0
    || gaps.failedTools.length > 0
    || gaps.missingArtifacts.length > 0
    || gaps.artifactClaimLimitExceeded
    || gaps.missingCurrentTurnEvidence
}

/** Reconstruct the latest claim and current evidence solely from one open turn. */
function inspectTurn(
  agent: Agent,
  turn: number,
  verifyAbsoluteArtifactClaims: boolean,
  requireCurrentTurnEvidence: boolean,
  maxArtifactClaims: number,
): TurnEvidence {
  const events = agent.session.events
  const start = events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  const emptyGaps: EvidenceGaps = {
    pendingTodos: 0,
    inProgressTodos: 0,
    callsWithoutResult: [],
    failedTools: [],
    missingArtifacts: [],
    artifactClaimLimitExceeded: false,
    missingCurrentTurnEvidence: requireCurrentTurnEvidence,
  }
  if (start < 0) return { recoveries: 0, gaps: emptyGaps }

  const calls = new Map<string, ToolOperation>()
  const pendingCalls = new Map<string, ToolOperation>()
  const latestOutcomeByOperation = new Map<string, { name: string; outcome: ToolOutcome }>()
  let successfulResults = 0
  let latestTodos: Array<{ status: string }> | undefined
  let latestAssistantText: string | undefined
  let recoveries = 0

  for (const event of events.slice(start + 1)) {
    if (event.type === 'assistant/message' && event.data.turn === turn) {
      latestAssistantText = visibleText(event.data.message.content)
      continue
    }
    if (event.type === 'todo/write') {
      latestTodos = event.data.todos
      continue
    }
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name
      && event.data.source.form === RECOVERY_FORM) {
      recoveries++
      continue
    }
    if (event.type === 'tool/call' && event.data.turn === turn) {
      const callId = String(event.data.callId)
      const operation = toolOperation(event.data.name, event.data.arguments)
      calls.set(callId, operation)
      pendingCalls.set(callId, operation)
      continue
    }
    if (event.type !== 'tool/result' || event.data.turn !== turn) continue
    const callId = String(event.data.message.source.callId)
    const operation = calls.get(callId)
    if (operation === undefined) continue
    pendingCalls.delete(callId)
    const resultBlock = event.data.message.content[0]
    const terminal = terminalFailure(event.data.meta)
    const failed = resultBlock.isError === true || terminal !== undefined
    const detail = terminal ?? event.data.error?.code
    latestOutcomeByOperation.set(operation.key, {
      name: operation.name,
      outcome: { failed, ...detail === undefined ? {} : { detail } },
    })
    if (!failed) successfulResults++
  }

  const claim = latestAssistantText !== undefined && isStrongGlobalCompletionClaim(latestAssistantText)
    ? latestAssistantText
    : undefined
  const pendingTodos = latestTodos?.filter(todo => todo.status === 'pending').length ?? 0
  const inProgressTodos = latestTodos?.filter(todo => todo.status === 'in_progress').length ?? 0
  const artifactClaims = claim !== undefined && verifyAbsoluteArtifactClaims
    ? absoluteArtifactClaims(claim, maxArtifactClaims)
    : { paths: [], limitExceeded: false }
  const missingArtifacts = artifactClaims.paths.filter(path => !existsSync(path))
  return {
    ...claim === undefined ? {} : { claim },
    recoveries,
    gaps: {
      pendingTodos,
      inProgressTodos,
      callsWithoutResult: [...pendingCalls.values()].map(operation => operation.name),
      failedTools: [...latestOutcomeByOperation.values()]
        .filter(({ outcome }) => outcome.failed)
        .map(({ name: toolName, outcome }) => ({
          name: toolName,
          ...outcome.detail === undefined ? {} : { detail: outcome.detail },
        })),
      missingArtifacts,
      artifactClaimLimitExceeded: artifactClaims.limitExceeded,
      missingCurrentTurnEvidence: requireCurrentTurnEvidence && successfulResults === 0,
    },
  }
}

/** Render bounded, model-visible facts explaining why the global claim is unsupported. */
function evidenceGapLines(gaps: EvidenceGaps): string[] {
  const lines: string[] = []
  if (gaps.pendingTodos > 0) lines.push(`- todos pending: ${gaps.pendingTodos}`)
  if (gaps.inProgressTodos > 0) lines.push(`- todos in_progress: ${gaps.inProgressTodos}`)
  if (gaps.callsWithoutResult.length > 0) {
    lines.push(`- tool calls without result: ${gaps.callsWithoutResult.join(', ')}`)
  }
  if (gaps.failedTools.length > 0) {
    lines.push(`- unresolved tool failures: ${gaps.failedTools
      .map(item => item.detail === undefined ? item.name : `${item.name} (${item.detail})`)
      .join(', ')}`)
  }
  if (gaps.missingArtifacts.length > 0) {
    lines.push(`- quoted artifacts not found: ${gaps.missingArtifacts.join(', ')}`)
  }
  if (gaps.artifactClaimLimitExceeded) {
    lines.push('- additional quoted artifacts were not checked because the configured claim limit was exceeded')
  }
  if (gaps.missingCurrentTurnEvidence) lines.push('- no successful tool result in the current turn')
  return lines
}

/** Take a Unicode-safe prefix whose encoded representation fits exactly in the byte budget. */
function utf8Prefix(value: string, maxBytes: number): string {
  const output: string[] = []
  let used = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output.push(character)
    used += bytes
  }
  return output.join('')
}

/** Bound the complete retained recovery message, including its fixed framing. */
function boundedRecoveryText(gaps: EvidenceGaps, maxBytes: number): string {
  const details = evidenceGapLines(gaps).join('\n')
  const complete = `${RECOVERY_HEADER}\n${details}\n${RECOVERY_INSTRUCTION}`
  if (Buffer.byteLength(complete, 'utf8') <= maxBytes) return complete

  const fixedFrame = `${RECOVERY_HEADER}\n\n${RECOVERY_TRUNCATION}\n${RECOVERY_INSTRUCTION}`
  const detailBudget = Math.max(0, maxBytes - Buffer.byteLength(fixedFrame, 'utf8'))
  const prefix = utf8Prefix(details, detailBudget).trimEnd()
  return `${RECOVERY_HEADER}\n${prefix.length > 0 ? `${prefix}\n` : ''}${RECOVERY_TRUNCATION}\n${RECOVERY_INSTRUCTION}`
}

/** Create the durable same-turn correction with exact evidence gaps. */
function evidenceRecoveryNotice(
  gaps: EvidenceGaps,
  recovery: number,
  limit: number,
  maxBytes: number,
) {
  const text = boundedRecoveryText(gaps, maxBytes)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: RECOVERY_FORM,
      summary: `${RECOVERY_SUMMARY}${recovery}/${limit}`,
    },
  })
}

/** Stable, bounded rejection after the configured correction allowance is exhausted. */
function completionEvidenceError(): HarnessError {
  return new HarnessError(COMPLETION_EVIDENCE_ERROR_MESSAGE, COMPLETION_EVIDENCE_UNSATISFIED)
}

/** Install the bounded completion-evidence policy. */
export function apply(ctx: Context, config: Config): void {
  const maxEvidenceRecoveries = config.maxEvidenceRecoveries ?? 0
  if (!Number.isInteger(maxEvidenceRecoveries)
    || maxEvidenceRecoveries < 0
    || maxEvidenceRecoveries > MAX_EVIDENCE_RECOVERIES) {
    throw new Error(
      `completion-claim-policy: maxEvidenceRecoveries ${maxEvidenceRecoveries} must be an integer between 0 and ${MAX_EVIDENCE_RECOVERIES}`,
    )
  }
  const maxRecoveryMessageBytes = config.maxRecoveryMessageBytes ?? DEFAULT_RECOVERY_MESSAGE_BYTES
  if (!Number.isInteger(maxRecoveryMessageBytes)
    || maxRecoveryMessageBytes < MIN_RECOVERY_MESSAGE_BYTES
    || maxRecoveryMessageBytes > MAX_RECOVERY_MESSAGE_BYTES) {
    throw new Error(
      `completion-claim-policy: maxRecoveryMessageBytes ${maxRecoveryMessageBytes} must be an integer between ${MIN_RECOVERY_MESSAGE_BYTES} and ${MAX_RECOVERY_MESSAGE_BYTES}`,
    )
  }
  const maxArtifactClaims = config.maxArtifactClaims ?? DEFAULT_MAX_ARTIFACT_CLAIMS
  if (!Number.isInteger(maxArtifactClaims)
    || maxArtifactClaims < 1
    || maxArtifactClaims > MAX_ARTIFACT_CLAIMS) {
    throw new Error(
      `completion-claim-policy: maxArtifactClaims ${maxArtifactClaims} must be an integer between 1 and ${MAX_ARTIFACT_CLAIMS}`,
    )
  }
  const verifyAbsoluteArtifactClaims = config.verifyAbsoluteArtifactClaims ?? false
  const requireCurrentTurnEvidence = config.requireCurrentTurnEvidence ?? false

  installTaskAcceptance(ctx)
  ctx.on('agent/turn-stopping', ({ agent, turn }): void => {
    const evidence = inspectTurn(
      agent,
      turn,
      verifyAbsoluteArtifactClaims,
      requireCurrentTurnEvidence,
      maxArtifactClaims,
    )
    if (evidence.claim === undefined || !hasGaps(evidence.gaps)) return
    if (evidence.recoveries < maxEvidenceRecoveries) {
      agent.steer(evidenceRecoveryNotice(
        evidence.gaps,
        evidence.recoveries + 1,
        maxEvidenceRecoveries,
        maxRecoveryMessageBytes,
      ))
      return
    }
    throw completionEvidenceError()
  })
}
