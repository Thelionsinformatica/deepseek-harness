/**
 * Durable recovery policy for repeated equivalent tool failures. A logged
 * notice follows the configured failure limit, and a monotonic tool guard
 * prevents the unchanged call from dispatching again until the agent changes
 * strategy or receives a new user message. Atomic state survives session
 * resume and remains independent of model/provider changes.
 * @module @deepseek-ai/dsh-failure-recovery-policy
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
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

/** Deployment policy for equivalent failures of one exact model-requested tool call. */
export interface Config {
  /** Failures permitted before the recovery notice and later denial (default 2). */
  maxEquivalentFailures?: number
  /** Tool-name wildcard patterns eligible for recovery; empty tracks every tool. */
  include?: string[]
  /** Tool-name wildcard patterns omitted from recovery tracking. */
  exclude?: string[]
}

export const Config: z<Config> = z.object({
  maxEquivalentFailures: z.number().default(2),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
})

const PLUGIN_SOURCE: MessageSource = {
  kind: 'plugin',
  plugin: 'failure-recovery-policy',
}

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
 * Install equivalent-failure observation, recovery guidance, and monotonic denial.
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
}
