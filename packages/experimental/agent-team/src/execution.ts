/** Opt-in mission admission over native LLM streaming and final tool guards. */
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from './mission-control.ts'
import { InferenceSlot } from './inference-slot.ts'
import { TeamError } from './error.ts'

/** Loader entry name. */
export const name = 'team-mission-execution'
/** Execution guards require the existing native owners. */
export const inject = ['agents', 'agentTeams', 'teamMissions', 'llm', 'tools', 'systemPrompt']
/** Explicit deployment route and tool allowlist, not model-controlled settings. */
export interface Config {
  provider: string
  model: string
  maxOutputTokens: number
  queueTimeoutMs: number
  allowedTools: string[]
  turnStepLimit?: number
  /** Final calls bind to a durable teammate ID or the host-provisioned checker function. */
  reviewReserve?: { calls: number; reviewerSessionId: string } | { calls: number; reviewerRole: 'checker' } | undefined
}
/** Lab-only configuration; no automatic cloud replacement or generic tool grant. */
export const Config: schema<Config> = schema.object({
  provider: schema.string().required(), model: schema.string().required(),
  maxOutputTokens: schema.number().step(1).min(1).required(),
  queueTimeoutMs: schema.number().step(1).min(1).max(2147483647).required(),
  allowedTools: schema.array(schema.string()).required(),
  turnStepLimit: schema.number().step(1).min(1).default(8),
  reviewReserve: schema.union([schema.const(undefined), schema.object({
    calls: schema.number().step(1).min(1).required(),
    reviewerSessionId: schema.string().required(),
  }), schema.object({
    calls: schema.number().step(1).min(1).required(),
    reviewerRole: schema.const('checker').required(),
  })]),
})

/**
 * Enforce mission admission, single-generation scheduling and cancellation.
 * The composition must bind the allowed route to a fixed verified local adapter;
 * a provider name or loopback URL alone does not establish local inference.
 * @param ctx - isolated laboratory runtime, never the production composition.
 * @param config - trusted route, output ceiling, queue deadline and exact tools.
 */
export function apply(ctx: Context, config: Config): void {
  const reserve = config.reviewReserve === undefined ? undefined : { ...config.reviewReserve }
  if (reserve !== undefined && (!Number.isSafeInteger(reserve.calls) || reserve.calls < 1
    || ('reviewerRole' in reserve
      ? !ctx.teamMissions.requiresComposition
      : typeof reserve.reviewerSessionId !== 'string' || !reserve.reviewerSessionId.trim()))) {
    throw new TeamError('Review reserve requires a host-bound persistent reviewerSessionId or enabled host checker composition', 'MISSION_REVIEW_CONFIG')
  }
  const slot = new InferenceSlot()
  const allowed = new Set(config.allowedTools)
  const active = new Set<Agent>()
  const deadlines = new Map<Agent, ReturnType<typeof setTimeout>>()
  let closed = false
  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step > (config.turnStepLimit ?? 8)) {
      throw new TeamError('Turn yielded to the host reviewer; mission budget is unchanged', 'MISSION_TURN_LIMIT')
    }
    return next()
  })
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, tools: assembly.tools.filter(tool => allowed.has(tool.name)) }
  })
  const root = (agent: Agent) => ctx.agentTeams.membership(agent).root
  const cancelTeam = (lead: Agent, reason?: string) => {
    for (const agent of ctx.agents.list()) {
      if (ctx.agentTeams.tryMembership(agent)?.root === lead) {
        agent.cancel(reason === undefined ? { kind: 'user' } : { kind: 'hook', reason }, { keepInbox: true })
      }
    }
  }
  const admit = (agent: Agent) => {
    if (closed) throw new TeamError('Mission executor closed', 'MISSION_CLOSED')
    const lead = root(agent)
    const record = ctx.teamMissions.get(lead)
    if (record.state !== 'running') throw new TeamError(`Mission is ${record.state}`, 'MISSION_NOT_RUNNING')
    if (Date.now() >= record.deadline) throw new TeamError('Mission deadline reached', 'MISSION_DEADLINE')
    if (reserve !== undefined && reserve.calls >= record.maxCalls) {
      throw new TeamError('Review reserve must leave calls for investigation', 'MISSION_REVIEW_CONFIG')
    }
    const bindings = ctx.teamMissions.requiresComposition ? ctx.teamMissions.getComposition(lead) : undefined
    const reviewerSessionId = reserve === undefined ? undefined
      : 'reviewerRole' in reserve ? bindings?.checker : reserve.reviewerSessionId
    if (reserve !== undefined && !ctx.agentTeams.listMembers(lead).some(member =>
      member.id === reviewerSessionId && member.role === 'teammate'
      && member.status !== 'failed' && member.status !== 'provisioning')) {
      throw new TeamError('Review reserve requires an existing teammate session in this mission', 'MISSION_REVIEW_CONFIG')
    }
    if (!deadlines.has(lead)) deadlines.set(lead, setTimeout(() => { cancelTeam(lead, 'Mission deadline reached') },
      Math.min(2147483647, Math.max(1, record.deadline - Date.now()))))
    return { lead, record, reviewerSessionId }
  }
  ctx.effect(() => ctx.tools.guard((exec) => {
    try {
      if (exec.agent === undefined) return 'Mission tool requires an identified agent'
      admit(exec.agent)
      if (!allowed.has(exec.name)) return `Tool ${exec.name} is not authorized for this mission`
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : 'Mission admission refused'
    }
  }))
  ctx.on('team-mission/changed', async (lead, record) => {
    if (record.state === 'running') return
    cancelTeam(lead, record.state === 'reviewing' ? 'Final evidence review' : undefined)
    if (record.state === 'reviewing') {
      await Promise.all(ctx.agents.list().filter(agent => ctx.agentTeams.tryMembership(agent)?.root === lead)
        .map(agent => agent.whenIdle()))
    }
  })
  ctx.on('agent/request', async (_payload, next) => {
    if (ctx.teamMissions.requiresComposition) {
      await ctx.teamMissions.waitForComposition(root(ctx.agents.requireInitiator()), _payload.signal)
    }
    const request = await next()
    return { ...request, maxTokens: Math.min(request.maxTokens ?? config.maxOutputTokens, config.maxOutputTokens) }
  })
  ctx.on('llm/stream', async function* (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) {
    const agent = ctx.agents.requireInitiator()
    if (ctx.teamMissions.requiresComposition) {
      if (options.signal === undefined) throw new TeamError('Model call requires cancellation', 'MISSION_SIGNAL_REQUIRED')
      await ctx.teamMissions.waitForComposition(root(agent), options.signal)
    }
    const { record } = admit(agent)
    if (options.provider !== config.provider || options.model !== config.model) {
      throw new TeamError('Model route is not authorized for this local mission', 'MISSION_ROUTE_DENIED')
    }
    if (options.maxTokens === undefined || options.maxTokens > config.maxOutputTokens) {
      throw new TeamError('Model output limit exceeds mission allowance', 'MISSION_OUTPUT_LIMIT')
    }
    if (options.signal === undefined) throw new TeamError('Model call requires cancellation', 'MISSION_SIGNAL_REQUIRED')
    const remaining = Math.min(config.queueTimeoutMs, record.deadline - Date.now())
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, remaining))])
    active.add(agent)
    let release: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      release = await slot.acquire(signal)
      signal.throwIfAborted()
      const current = admit(agent)
      if (reserve !== undefined) {
        const member = ctx.agentTeams.membership(agent)
        const isReviewer = member.role === 'teammate'
          && agent.id === current.reviewerSessionId
        if (current.record.calls >= current.record.maxCalls - reserve.calls && !isReviewer) {
          throw new TeamError('Remaining calls are reserved for the final reviewer', 'MISSION_REVIEW_RESERVED')
        }
      }
      await ctx.teamMissions.reserveCall(current.lead)
      admit(agent)
      options.signal.throwIfAborted()
      timer = setTimeout(() => { agent.cancel({ kind: 'hook', reason: 'Mission deadline reached' }) },
        Math.min(2147483647, Math.max(1, current.record.deadline - Date.now())))
      yield* next()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      release?.()
      active.delete(agent)
    }
  })
  ctx.effect(() => async () => {
    closed = true
    slot.close()
    for (const timer of deadlines.values()) clearTimeout(timer)
    const pending = [...active]
    for (const agent of pending) agent.cancel({ kind: 'disposed' }, { keepInbox: true })
    await Promise.all(pending.map(agent => agent.whenIdle()))
  })
}
