/**
 * Monotonic tool guard that preserves a Windows target explicitly selected in
 * the latest direct user message of a turn.
 * @module @deepseek-ai/dsh-explicit-target-policy
 */

import { win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'explicit-target-policy'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Same-turn recovery notice injected when required target tools are still missing. */
    'explicit-target-policy': { kind: 'explicit-target-policy' } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Open-turn facts this guard needs after resume: direct text, recoveries, and path-bearing calls. */
    explicitTargetTurn: ExplicitTargetTurnState
  }
}

/** The tool registry whose monotonic guard this plugin extends, and the projection registry for durable turn facts. */
export const inject = ['tools', 'sessionProjections']

/** Configuration for recognizing explicit target suffixes in direct user text. */
export interface Config {
  /** Case- and separator-insensitive suffixes such as `.leon/knowledge`. */
  markers: string[]
  /** Additional model tools whose path argument participates in the lock. */
  additionalToolRules?: AdditionalToolRule[]
  /** Root model tools denied while a direct-human target lock is active. */
  blockedToolsWhileLocked?: string[]
  /** Successful root tools required before a locked turn may stop. */
  requiredToolsWhileLocked?: string[]
  /** Same-turn continuations used to obtain missing required tools. */
  maxRequiredToolRecoveries?: number
}

/** Deployment-owned path rule for a model tool not built into this policy. */
export interface AdditionalToolRule {
  /** Exact model-facing tool name. */
  name: string
  /** Argument that carries the absolute path. */
  argument: string
  /** Deny the tool unless the latest direct human message established a lock. */
  requireLock?: boolean
  /** Permit only the exact locked target, not descendants. */
  exact?: boolean
}

/** Loader validation for the required, non-empty marker list. */
export const Config: z<Config> = z.object({
  markers: z.array(z.string().min(1)).min(1).required(),
  additionalToolRules: z.array(z.object({
    name: z.string().min(1).required(),
    argument: z.string().min(1).required(),
    requireLock: z.boolean().default(false),
    exact: z.boolean().default(false),
  })),
  blockedToolsWhileLocked: z.array(z.string().min(1)),
  requiredToolsWhileLocked: z.array(z.string().min(1)),
  maxRequiredToolRecoveries: z.number().step(1).min(0).max(3).default(0),
})

interface ToolPathRule {
  readonly argument: string
  readonly requireLock: boolean
  readonly exact: boolean
}

const DEFAULT_TOOL_RULES = new Map<string, ToolPathRule>([
  ['glob', { argument: 'path', requireLock: false, exact: false }],
  ['grep', { argument: 'path', requireLock: false, exact: false }],
  ['read', { argument: 'file_path', requireLock: false, exact: false }],
  ['read_image', { argument: 'file_path', requireLock: false, exact: false }],
  ['write', { argument: 'file_path', requireLock: false, exact: false }],
  ['edit', { argument: 'file_path', requireLock: false, exact: false }],
])

const WINDOWS_DRIVE_PREFIX = /[a-z]:\//gu

interface TargetLock {
  readonly turn: number
  readonly targets: readonly string[]
  readonly completedToolTargets: Set<string>
  requiredToolRecoveries: number
}

interface RequiredToolTarget {
  readonly tool: string
  readonly target: string
}

const REQUIRED_RECOVERY_SUMMARY = 'required tools: continue protected turn'

const explicitTargetTurnStateSchema = zod.object({
  /** Open turn number, or null before the first `turn/start`. */
  turn: zod.number().nullable(),
  /** Text of the latest direct-human message in the open turn. */
  directText: zod.string().nullable(),
  /** Recovery notices this guard already injected in the open turn. */
  recoveries: zod.number(),
  /**
   * Root tool calls of the open turn keyed by call id. Only absolute Windows
   * path arguments are retained, so large write payloads never enter the
   * projection; `ok` is null until the matching `tool/result` arrives.
   */
  calls: zod.record(zod.string(), zod.object({
    name: zod.string(),
    paths: zod.record(zod.string(), zod.string()),
    ok: zod.boolean().nullable(),
  })),
})

/** Folded open-turn facts read by the guard instead of scanning Session history. */
type ExplicitTargetTurnState = zod.infer<typeof explicitTargetTurnStateSchema>

const EMPTY_TURN_STATE: ExplicitTargetTurnState = { turn: null, directText: null, recoveries: 0, calls: {} }

/** Keep only top-level string arguments that are absolute Windows paths, normalized. */
function pathArguments(rawArguments: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    // Invalid model JSON is never dispatched, so it cannot complete a required call.
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const paths: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = typeof value === 'string' ? normalizeWindowsPath(value) : undefined
    if (normalized !== undefined) paths[key] = normalized
  }
  return paths
}

/**
 * Pure fold of the open turn. Returns the same reference for every event the
 * guard does not need, as the projection contract requires.
 * @param state - facts covering all prior events.
 * @param event - the next committed Session event.
 * @returns the next facts.
 */
function applyTurnEvent(state: ExplicitTargetTurnState, event: SessionEvent): ExplicitTargetTurnState {
  switch (event.type) {
    case 'turn/start':
      return { turn: event.data.turn, directText: null, recoveries: 0, calls: {} }
    case 'user/message': {
      const source = event.data.source
      if (source.kind === 'user') return { ...state, directText: messageText(event.data) }
      if (source.kind === name && source.form === 'notice' && source.summary === REQUIRED_RECOVERY_SUMMARY) {
        return { ...state, recoveries: state.recoveries + 1 }
      }
      return state
    }
    case 'tool/call': {
      if (event.data.turn !== state.turn) return state
      const call = { name: event.data.name, paths: pathArguments(event.data.arguments), ok: null }
      return { ...state, calls: { ...state.calls, [String(event.data.callId)]: call } }
    }
    case 'tool/result': {
      if (event.data.turn !== state.turn) return state
      const callId = String(event.data.message.toolCallId)
      const call = state.calls[callId]
      if (call === undefined) return state
      return { ...state, calls: { ...state.calls, [callId]: { ...call, ok: event.data.message.isError !== true } } }
    }
    default:
      return state
  }
}

/** Normalize Unicode, separators, case, and lexical Windows path segments. */
function normalizeWindowsPath(value: string): string | undefined {
  const folded = value.normalize('NFKC').trim().replaceAll('\\', '/')
  if (!/^[a-z]:\//iu.test(folded)) return undefined
  const normalized = win32.normalize(folded.replaceAll('/', '\\'))
    .replaceAll('\\', '/')
    .toLowerCase()
  if (!/^[a-z]:\//u.test(normalized)) return undefined
  return normalized.length === 3 ? normalized : normalized.replace(/\/+$/u, '')
}

/** Normalize one configured suffix for literal matching in normalized user text. */
function normalizeMarker(value: string): string {
  return value.normalize('NFKC').trim().replaceAll('\\', '/').replace(/\/+/gu, '/').toLowerCase()
}

/** Find the final drive-root prefix whose start precedes one marker occurrence. */
function lastDrivePrefixBefore(text: string, markerIndex: number): number | undefined {
  WINDOWS_DRIVE_PREFIX.lastIndex = 0
  let found: number | undefined
  for (;;) {
    const match = WINDOWS_DRIVE_PREFIX.exec(text)
    if (match === null || match.index > markerIndex) break
    found = match.index
  }
  WINDOWS_DRIVE_PREFIX.lastIndex = 0
  return found
}

/** Extract and de-duplicate absolute targets ending at configured markers. */
function extractTargets(text: string, markers: readonly string[]): string[] {
  const normalizedText = text.normalize('NFKC').replaceAll('\\', '/').toLowerCase()
  const targets: string[] = []
  for (const marker of markers) {
    let from = 0
    for (;;) {
      const markerIndex = normalizedText.indexOf(marker, from)
      if (markerIndex < 0) break
      const prefixIndex = lastDrivePrefixBefore(normalizedText, markerIndex)
      if (prefixIndex !== undefined) {
        const candidate = normalizeWindowsPath(
          normalizedText.slice(prefixIndex, markerIndex + marker.length),
        )
        if (candidate !== undefined && !targets.includes(candidate)) targets.push(candidate)
      }
      from = markerIndex + Math.max(marker.length, 1)
    }
  }
  return targets
}

/** Concatenate the text blocks of one user-role message without inspecting non-text content. */
function messageText(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content
    .filter((block): block is { readonly type: 'text'; readonly text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Whether a normalized candidate is exactly one target or a descendant of it. */
function insideAnyTarget(candidate: string, targets: readonly string[]): boolean {
  return targets.some(target => candidate === target || candidate.startsWith(`${target}/`))
}

/** Model-visible local denial that preserves the exact normalized target. */
function targetDriftReason(targets: readonly string[]): string {
  const exact = targets.map(target => `"${target}"`).join(' ou ')
  return `TARGET_DRIFT: repita a chamada no alvo exato ${exact} ou em um descendente; `
    + 'não use caminho relativo, ".", o workspace, uma pasta-pai ou outro alvo.'
}

/** Model-visible denial for an external-path tool that requires human authority. */
function targetRequiredReason(markers: readonly string[]): string {
  return `TARGET_REQUIRED: a mensagem humana direta atual deve indicar um caminho absoluto terminando em ${markers.join(' ou ')}; `
    + 'contexto de plugin, histórico, memória e resultado de ferramenta não concedem esse acesso.'
}

/** Model-visible denial that prevents generic tools from bypassing a dedicated target tool. */
function targetToolRestrictedReason(toolName: string, targets: readonly string[]): string {
  const exact = targets.map(target => `"${target}"`).join(' ou ')
  return `TARGET_TOOL_RESTRICTED: ${toolName} não é permitido enquanto o alvo protegido ${exact} estiver ativo; `
    + 'use somente as ferramentas dedicadas indicadas pela Skill e não tente outro caminho, shell ou código.'
}

/** Same-turn correction when a local model narrates work without executing required tools. */
function requiredToolsRecoveryNotice(missing: readonly RequiredToolTarget[]) {
  const tools = [...new Set(missing.map(item => item.tool))]
    .map(tool => `\`${tool}\``)
    .join(' e ')
  const targets = [...new Set(missing.map(item => item.target))]
    .map(target => `"${target}"`)
    .join(' e ')
  return createUserMessage({
    content: [{
      type: 'text',
      text: 'Execução obrigatória ainda incompleta. Antes de encerrar este mesmo turno, chame com sucesso '
        + `${tools} em cada alvo ainda pendente (${targets}). `
        + 'Não repita o plano, não use ferramenta genérica e só então entregue uma resposta final baseada nos resultados.',
    }],
    source: {
      kind: name,
      form: 'notice',
      summary: REQUIRED_RECOVERY_SUMMARY,
    },
  })
}

/** Stable failure after the bounded correction budget is exhausted. */
function requiredToolsMissingError(missing: readonly RequiredToolTarget[]): Error {
  const pairs = missing.map(item => `${item.tool}@${item.target}`).join(', ')
  return new Error(
    `REQUIRED_TOOLS_MISSING: o turno protegido não pode ser concluído sem sucesso de ${pairs}`,
  )
}

/** Validate and normalize configured markers once at plugin load. */
function resolveMarkers(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error('explicit-target-policy: `markers` must not be empty')
  }
  const markers = values.map((value) => {
    const marker = normalizeMarker(value)
    if (marker.length === 0) {
      throw new Error('explicit-target-policy: every marker must contain non-whitespace text')
    }
    return marker
  })
  return [...new Set(markers)]
}

/** Merge deployment rules without allowing built-in semantics to be replaced. */
function resolveToolRules(values: readonly AdditionalToolRule[]): Map<string, ToolPathRule> {
  const rules = new Map(DEFAULT_TOOL_RULES)
  for (const value of values) {
    const toolName = value.name.trim()
    const argument = value.argument.trim()
    if (toolName.length === 0 || argument.length === 0) {
      throw new Error('explicit-target-policy: additional tool names and arguments must not be blank')
    }
    if (rules.has(toolName)) {
      throw new Error(`explicit-target-policy: duplicate tool path rule for ${toolName}`)
    }
    rules.set(toolName, {
      argument,
      requireLock: value.requireLock === true,
      exact: value.exact === true,
    })
  }
  return rules
}

/** Normalize a deployment denylist and reject ambiguous duplicate or blank names. */
function resolveBlockedTools(values: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const value of values) {
    const toolName = value.trim()
    if (toolName.length === 0) {
      throw new Error('explicit-target-policy: blocked tool names must not be blank')
    }
    if (names.has(toolName)) {
      throw new Error(`explicit-target-policy: duplicate blocked tool name ${toolName}`)
    }
    names.add(toolName)
  }
  return names
}

/** Normalize required tool names with the same fail-closed naming contract. */
function resolveRequiredTools(values: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const value of values) {
    const toolName = value.trim()
    if (toolName.length === 0) {
      throw new Error('explicit-target-policy: required tool names must not be blank')
    }
    if (names.has(toolName)) {
      throw new Error(`explicit-target-policy: duplicate required tool name ${toolName}`)
    }
    names.add(toolName)
  }
  return names
}

/** Whether two normalized target sets preserve the same direct-human authority. */
function sameTargets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((target, index) => target === right[index])
}

/** Stable set key for one required tool on one authorized target. */
function requiredToolTargetKey(tool: string, target: string): string {
  return JSON.stringify([tool, target])
}

/** Resolve the authorized target carried by one path-bearing root tool call. */
function requiredToolTarget(
  toolName: string,
  argumentsValue: unknown,
  targets: readonly string[],
  toolRules: ReadonlyMap<string, ToolPathRule>,
): string | undefined {
  const rule = toolRules.get(toolName)
  if (rule === undefined || argumentsValue === null || typeof argumentsValue !== 'object') return undefined
  const rawPath = (argumentsValue as Record<string, unknown>)[rule.argument]
  const candidate = typeof rawPath === 'string' ? normalizeWindowsPath(rawPath) : undefined
  if (candidate === undefined) return undefined
  return targets.find(target => rule.exact
    ? candidate === target
    : candidate === target || candidate.startsWith(`${target}/`))
}

/** Folded open-turn facts for one turn, or undefined when the projection describes another turn. */
type TurnReader = (agent: Agent, turn: number) => ExplicitTargetTurnState | undefined

/** Find the latest durable direct-human text inside one open turn. */
function durableDirectText(read: TurnReader, agent: Agent, turn: number): string | undefined {
  return read(agent, turn)?.directText ?? undefined
}

/** Count durable recovery notices already consumed by one open turn. */
function durableRequiredToolRecoveries(read: TurnReader, agent: Agent, turn: number): number {
  return read(agent, turn)?.recoveries ?? 0
}

/** Reconstruct successful required calls already committed in one open turn. */
function durableCompletedToolTargets(
  read: TurnReader,
  agent: Agent,
  turn: number,
  targets: readonly string[],
  requiredTools: ReadonlySet<string>,
  toolRules: ReadonlyMap<string, ToolPathRule>,
): Set<string> {
  const completed = new Set<string>()
  for (const call of Object.values(read(agent, turn)?.calls ?? {})) {
    if (call.ok !== true || !requiredTools.has(call.name)) continue
    const target = requiredToolTarget(call.name, call.paths, targets, toolRules)
    if (target !== undefined) completed.add(requiredToolTargetKey(call.name, target))
  }
  return completed
}

/** Verify that a final tool result belongs to a model call durably logged in this turn. */
function hasDurableToolCall(read: TurnReader, agent: Agent, lock: TargetLock, exec: Readonly<ToolExecution>): boolean {
  return read(agent, lock.turn)?.calls[String(exec.callId)]?.name === exec.name
}

/** Enumerate every required tool-target pair not yet completed successfully. */
function missingRequiredToolTargets(
  lock: TargetLock,
  requiredTools: ReadonlySet<string>,
): RequiredToolTarget[] {
  const missing: RequiredToolTarget[] = []
  for (const target of lock.targets) {
    for (const tool of requiredTools) {
      if (!lock.completedToolTargets.has(requiredToolTargetKey(tool, target))) {
        missing.push({ tool, target })
      }
    }
  }
  return missing
}

/**
 * Install per-agent target capture and a monotonic root-tool guard.
 * @param ctx - plugin context; both registrations are disposed with its fiber.
 * @param config - required target suffixes used only on direct human messages.
 */
export function apply(ctx: Context, config: Config): void {
  const markers = resolveMarkers(config.markers)
  const toolRules = resolveToolRules(config.additionalToolRules ?? [])
  const blockedTools = resolveBlockedTools(config.blockedToolsWhileLocked ?? [])
  const requiredTools = resolveRequiredTools(config.requiredToolsWhileLocked ?? [])
  const maxRequiredToolRecoveries = config.maxRequiredToolRecoveries ?? 0
  if (!Number.isInteger(maxRequiredToolRecoveries)
    || maxRequiredToolRecoveries < 0
    || maxRequiredToolRecoveries > 3) {
    throw new Error(
      'explicit-target-policy: `maxRequiredToolRecoveries` must be an integer between 0 and 3',
    )
  }
  for (const toolName of requiredTools) {
    if (blockedTools.has(toolName)) {
      throw new Error(`explicit-target-policy: required tool ${toolName} cannot also be blocked`)
    }
    if (!toolRules.has(toolName)) {
      throw new Error(`explicit-target-policy: required tool ${toolName} must have a path rule`)
    }
  }
  const locks = new WeakMap<Agent, TargetLock>()

  ctx.sessionProjections.register({
    key: 'explicitTargetTurn',
    stateVersion: 1,
    stateSchema: explicitTargetTurnStateSchema,
    init: () => EMPTY_TURN_STATE,
    apply: applyTurnEvent,
  })
  const read: TurnReader = (agent, turn) => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'explicitTargetTurn')
    return state?.turn === turn ? state : undefined
  }

  ctx.on('agent/pre-step', async ({ agent, turn }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const direct = decision.messages.findLast(message => message.source.kind === 'user')
    const previous = locks.get(agent)
    let targets = previous?.turn === turn ? previous.targets : []
    const directText = direct === undefined ? durableDirectText(read, agent, turn) : messageText(direct)
    if (directText !== undefined) targets = extractTargets(directText, markers)
    const preserve = previous?.turn === turn && sameTargets(previous.targets, targets)
    const durableCompleted = durableCompletedToolTargets(
      read,
      agent,
      turn,
      targets,
      requiredTools,
      toolRules,
    )
    locks.set(agent, {
      turn,
      targets,
      completedToolTargets: preserve
        ? new Set([...previous.completedToolTargets, ...durableCompleted])
        : durableCompleted,
      requiredToolRecoveries: Math.max(
        preserve ? previous.requiredToolRecoveries : 0,
        durableRequiredToolRecoveries(read, agent, turn),
      ),
    })
    return decision
  })

  ctx.tools.guard((exec: Readonly<ToolExecution>): string | undefined => {
    if (exec.agent === undefined || exec.parent !== undefined) return undefined
    const targets = locks.get(exec.agent)?.targets ?? []
    if (targets.length > 0 && blockedTools.has(exec.name)) {
      return targetToolRestrictedReason(exec.name, targets)
    }
    const rule = toolRules.get(exec.name)
    if (rule === undefined) return undefined
    if (targets.length === 0) return rule.requireLock ? targetRequiredReason(markers) : undefined

    const argumentsValue = exec.arguments
    const rawPath = argumentsValue !== null && typeof argumentsValue === 'object'
      ? (argumentsValue as Record<string, unknown>)[rule.argument]
      : undefined
    const candidate = typeof rawPath === 'string' ? normalizeWindowsPath(rawPath) : undefined
    const allowed = candidate !== undefined && (
      rule.exact ? targets.includes(candidate) : insideAnyTarget(candidate, targets)
    )
    return allowed
      ? undefined
      : targetDriftReason(targets)
  })

  ctx.on('tools/result', (exec, result): undefined => {
    if (exec.agent === undefined || exec.parent !== undefined || result.isError
      || !requiredTools.has(exec.name)) return undefined
    const lock = locks.get(exec.agent)
    if (lock === undefined || !hasDurableToolCall(read, exec.agent, lock, exec)) return undefined
    const target = requiredToolTarget(exec.name, exec.arguments, lock.targets, toolRules)
    if (target !== undefined) {
      lock.completedToolTargets.add(requiredToolTargetKey(exec.name, target))
    }
    return undefined
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }): void => {
    const lock = locks.get(agent)
    if (lock === undefined || lock.turn !== turn || lock.targets.length === 0
      || requiredTools.size === 0) return
    const missing = missingRequiredToolTargets(lock, requiredTools)
    if (missing.length === 0) return
    const durableRecoveries = durableRequiredToolRecoveries(read, agent, turn)
    lock.requiredToolRecoveries = Math.max(lock.requiredToolRecoveries, durableRecoveries)
    if (lock.requiredToolRecoveries < maxRequiredToolRecoveries) {
      lock.requiredToolRecoveries++
      agent.steer(requiredToolsRecoveryNotice(missing))
      return
    }
    throw requiredToolsMissingError(missing)
  })
}
