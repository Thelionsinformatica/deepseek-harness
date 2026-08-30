/**
 * Durable recovery policy for repeated equivalent tool failures and terminal
 * model responses without final output. Tool failures receive a logged notice
 * and a monotonic dispatch guard; reasoning-only or blank responses receive a
 * bounded, same-turn continuation before they become a visible error. Atomic
 * tool state and logged response-recovery notices survive session resume and
 * remain independent of model/provider changes.
 * @module @deepseek-ai/dsh-failure-recovery-policy
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, MessageSource, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import { RecoveryEventId, RecoveryScopeKey } from './contracts.ts'
import { failureRecoveryDomainSpec } from './spec.ts'
import { DomainAtomicRecoveryStore } from './store.ts'
import type { AtomicRecoveryStore, RecoveryFailure } from './types.ts'

export {
  RecoveryEventId,
  RecoveryOperationId,
  RecoveryScopeKey,
  defineToolPolicy,
  resolveToolPolicy,
} from './contracts.ts'
export { failureRecoveryDomainSpec, recoveryRecord } from './spec.ts'
export { DomainAtomicRecoveryStore, MemoryAtomicRecoveryStore } from './store.ts'
export type {
  AtomicRecoveryStore,
  CanonicalInvocation,
  DispatchPhase,
  InvocationOutcome,
  LeaseReservation,
  OutcomeDomain,
  RecordFailureInput,
  RecoveryEvent,
  RecoveryEventId as RecoveryEventIdentity,
  RecoveryFailure,
  RecoveryLease,
  RecoveryOperationId as RecoveryOperationIdentity,
  RecoveryRecord,
  RecoveryScopeKey as RecoveryScopeIdentity,
  RecoveryStatus,
  ResolvedToolPolicy,
  ToolEffect,
  ToolPolicy,
} from './types.ts'

export const name = 'failure-recovery-policy'
export const inject = ['tools', 'storageDomain']

/** Stable failure code for a terminal model response with no actionable or user-facing output. */
export const NO_FINAL_RESPONSE_CODE = 'NO_FINAL_RESPONSE'

/** Deployment policy for equivalent failures of one exact model-requested tool call. */
export interface Config {
  /** Failures permitted before the recovery notice and later denial (default 2). */
  maxEquivalentFailures?: number
  /** Same-turn steering attempts after a terminal response without final output (default 0, maximum 3). */
  maxNoFinalResponseRecoveries?: number
  /** Tool-name wildcard patterns eligible for recovery; empty tracks every tool. */
  include?: string[]
  /** Tool-name wildcard patterns omitted from recovery tracking. */
  exclude?: string[]
}

export const Config: z<Config> = z.object({
  maxEquivalentFailures: z.number().default(2),
  maxNoFinalResponseRecoveries: z.number().default(0),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
})

const PLUGIN_NAME = 'failure-recovery-policy'

const PLUGIN_SOURCE: MessageSource = {
  kind: 'plugin',
  plugin: PLUGIN_NAME,
}

const NO_FINAL_RESPONSE_RECOVERY_SUMMARY = 'Final response recovery '
const MAX_NO_FINAL_RESPONSE_RECOVERIES = 3

interface FailureObservation {
  key: string
  code: string
}

/** Stable argument identity for lossless JSON input regardless of object-key order. */
function canonicalArguments(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
    return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  })
}

/** Compile a literal tool-name pattern whose only special character is `*`. */
function compileWildcard(pattern: string): RegExp {
  const escaped = pattern.split('*')
    .map(part => part.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`))
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

/** Identity for one final failure without retaining result content beyond process memory. */
function failureObservation(
  result: Readonly<ToolExecutionResult>,
  decision: PostToolDecision,
): FailureObservation | undefined {
  if (decision.kind === 'block') {
    return { key: 'post-execute-block', code: 'POST_EXECUTE_BLOCK' }
  }
  if (!result.isError) return undefined
  if (result.error.info !== undefined) {
    const { name: errorName, code } = result.error.info
    return { key: `structured:${errorName}:${code}`, code }
  }
  return {
    key: `message:${result.error.message}`,
    code: 'UNSTRUCTURED_TOOL_ERROR',
  }
}

/** Model-visible recovery context after the configured equivalent-failure limit. */
function recoveryNotice(toolName: string, count: number, failureCode: string) {
  const text = 'The same tool call has failed repeatedly with an equivalent failure.\n'
    + `- tool: ${toolName}\n`
    + `- equivalent_failures: ${count}\n`
    + `- failure_code: ${failureCode}\n`
    + 'Identify the likely cause from the logged tool results before continuing. '
    + 'Do not repeat this exact call. Change the tool, arguments, or strategy, or '
    + 'finish the task if the available evidence is sufficient.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      ...PLUGIN_SOURCE,
      form: 'notice',
      summary: `${toolName} failed × ${count}`,
    },
  })
}

/** Model-visible steering after a response stopped at reasoning or blank text. */
function finalResponseRecoveryNotice(recovery: number, limit: number) {
  const text = 'The previous model response stopped after internal reasoning or blank text without completing the task. '
    + 'Continue now: call the tools required to execute the pending work, or provide the final user-facing answer '
    + 'if no tool is needed. Do not repeat or restate the plan.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      ...PLUGIN_SOURCE,
      form: 'notice',
      summary: `${NO_FINAL_RESPONSE_RECOVERY_SUMMARY}${recovery}/${limit}`,
    },
  })
}

/** A final answer, tool call, or extension block can end a turn; reasoning and blank text cannot. */
function hasTerminalOutput(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'text'
    ? /[^\s\p{Cf}]/u.test(block.text)
    : block.type !== 'reasoning')
}

interface CurrentTurnTerminalState {
  content?: readonly ContentBlock[]
  finishKind?: string
  recoveries: number
}

/** Summarize only the open turn's durable tail without copying the session log. */
function currentTurnTerminalState(agent: Agent, turn: number): CurrentTurnTerminalState {
  let assistantStep: number | undefined
  let finishKind: string | undefined
  let content: readonly ContentBlock[] | undefined
  let recoveries = 0
  let foundTurn = false
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start') {
      foundTurn = event.data.turn === turn
      break
    }
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === PLUGIN_NAME
      && event.data.source.form === 'notice'
      && event.data.source.summary.startsWith(NO_FINAL_RESPONSE_RECOVERY_SUMMARY)) {
      recoveries++
      continue
    }
    if (event.type === 'assistant/chunk'
      && event.data.turn === turn
      && event.data.step === assistantStep
      && event.data.chunk.type === 'finish') {
      finishKind ??= event.data.chunk.reason.kind
      continue
    }
    if (assistantStep === undefined && event.type === 'assistant/message' && event.data.turn === turn) {
      assistantStep = event.data.step
      content = event.data.message.content
    }
  }
  if (!foundTurn) return { recoveries: 0 }
  return {
    recoveries,
    ...content === undefined ? {} : { content },
    ...finishKind === undefined ? {} : { finishKind },
  }
}

/** Whether the latest assistant message in this turn ended without terminal output. */
function terminalResponseWithoutOutput(state: CurrentTurnTerminalState): boolean {
  if (state.content === undefined || state.finishKind === 'max-tokens') return false
  return !hasTerminalOutput(state.content)
}

/** Count this policy's recovery notices after the latest direct user input. */
function finalResponseRecoveries(messages: readonly Message[]): number {
  let recoveries = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined) continue
    const { source } = message
    if (source.kind === 'user') break
    if (source.kind === 'plugin'
      && source.plugin === PLUGIN_NAME
      && source.form === 'notice'
      && source.summary.startsWith(NO_FINAL_RESPONSE_RECOVERY_SUMMARY)) recoveries++
  }
  return recoveries
}

/** Convert only a completed empty response after the configured recovery allowance. */
async function* guardFinalResponse(
  source: AsyncIterable<StreamChunk>,
  recoveries: number,
): AsyncIterable<StreamChunk> {
  const content: ContentBlock[] = []
  for await (const chunk of source) {
    if (chunk.type === 'block-end') content.push(chunk.block)
    if (chunk.type !== 'finish'
      || chunk.reason.kind === 'error'
      || chunk.reason.kind === 'aborted'
      || chunk.reason.kind === 'max-tokens'
      || hasTerminalOutput(content)) {
      yield chunk
      continue
    }
    const attemptLabel = recoveries === 1 ? 'attempt' : 'attempts'
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: NO_FINAL_RESPONSE_CODE,
          message: `model stopped without a final answer or tool call after ${recoveries} recovery ${attemptLabel}`,
        },
      },
    }
  }
}

/** Final denial text for an unchanged call whose equivalent-failure allowance is exhausted. */
function denialReason(toolName: string, chain: RecoveryFailure): string {
  return `repeated tool failure blocked for "${toolName}": this exact call already failed `
    + `${chain.count} times with equivalent failure code ${chain.failureCode}; change the tool, `
    + 'arguments, or strategy before trying again'
}

/** Preserve downstream contexts while placing recovery guidance first. */
function withRecovery(decision: PostToolDecision, recovery: ReturnType<typeof recoveryNotice>): PostToolDecision {
  const additionalContexts = [recovery, ...decision.additionalContexts ?? []]
  return decision.kind === 'block'
    ? { kind: 'block', feedback: decision.feedback, additionalContexts }
    : { ...decision, additionalContexts }
}

/**
 * Install tool-failure observation, bounded final-response recovery, and monotonic denial.
 * @param ctx - plugin context carrying the tool registry and agent events.
 * @param config - validated deployment policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const maxEquivalentFailures = config.maxEquivalentFailures as number
  if (!Number.isInteger(maxEquivalentFailures) || maxEquivalentFailures < 2) {
    throw new Error(
      `failure-recovery-policy: invalid maxEquivalentFailures ${maxEquivalentFailures} — must be an integer >= 2`,
    )
  }
  const maxNoFinalResponseRecoveries = config.maxNoFinalResponseRecoveries as number
  if (!Number.isInteger(maxNoFinalResponseRecoveries)
    || maxNoFinalResponseRecoveries < 0
    || maxNoFinalResponseRecoveries > MAX_NO_FINAL_RESPONSE_RECOVERIES) {
    throw new Error(
      'failure-recovery-policy: invalid maxNoFinalResponseRecoveries '
      + `${maxNoFinalResponseRecoveries} — must be an integer between 0 and ${MAX_NO_FINAL_RESPONSE_RECOVERIES}`,
    )
  }
  const include = (config.include as string[]).map(compileWildcard)
  const exclude = (config.exclude as string[]).map(compileWildcard)
  const policyDenials = new Set<ToolExecutionToken>()
  const domain = await ctx.storageDomain.open(failureRecoveryDomainSpec)
  ctx.effect(() => () => domain.close(), 'failure-recovery-policy.domainClose')
  const store: AtomicRecoveryStore = new DomainAtomicRecoveryStore(domain.table('scopes'))

  function scopeKey(agent: Agent) {
    return RecoveryScopeKey(`session:${agent.id}`)
  }

  function eventId(kind: string, exec?: ToolExecution) {
    return RecoveryEventId(exec === undefined
      ? `${kind}:${randomUUID()}`
      : `${kind}:${exec.agent?.id ?? 'direct'}:${exec.callId}`)
  }

  function tracked(exec: ToolExecution): exec is ToolExecution & { agent: Agent } {
    if (exec.agent === undefined || exec.parent !== undefined) return false
    if (include.length > 0 && !include.some(pattern => pattern.test(exec.name))) return false
    return !exclude.some(pattern => pattern.test(exec.name))
  }

  function callKey(exec: ToolExecution): string {
    return JSON.stringify([exec.name, canonicalArguments(exec.arguments)])
  }

  ctx.tools.guard((exec): string | undefined => {
    if (!tracked(exec)) return undefined
    const chain = store.read(scopeKey(exec.agent))?.failure
    if (chain === undefined || chain.callKey !== callKey(exec)
      || chain.count < maxEquivalentFailures) return undefined
    policyDenials.add(exec.token)
    return denialReason(exec.name, chain)
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const downstream = await next()
    if (!tracked(exec)) return downstream
    if (policyDenials.delete(exec.token)) return downstream

    const observed = failureObservation(result, downstream)
    if (observed === undefined) {
      await store.reset(scopeKey(exec.agent), eventId('success', exec), Date.now())
      return downstream
    }

    const key = callKey(exec)
    const record = await store.recordFailure(scopeKey(exec.agent), {
      callKey: key,
      familyKey: key,
      failureKey: observed.key,
      failureCode: observed.code,
      limit: maxEquivalentFailures,
    }, eventId('failure', exec), Date.now())
    const count = record.failure?.count ?? 0
    return count === maxEquivalentFailures
      ? withRecovery(downstream, recoveryNotice(exec.name, count, observed.code))
      : downstream
  })

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      await store.reset(scopeKey(agent), eventId(`user:${agent.id}`), Date.now())
    }
    return next()
  })

  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    if (!isAgentLoopRequest(options)) return next()
    const recoveries = finalResponseRecoveries(options.messages)
    const stream = next()
    return recoveries < maxNoFinalResponseRecoveries ? stream : guardFinalResponse(stream, recoveries)
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }): void => {
    const state = currentTurnTerminalState(agent, turn)
    if (!terminalResponseWithoutOutput(state)) return
    const { recoveries } = state
    if (recoveries < maxNoFinalResponseRecoveries) {
      agent.steer(finalResponseRecoveryNotice(recoveries + 1, maxNoFinalResponseRecoveries))
    }
  })
}
