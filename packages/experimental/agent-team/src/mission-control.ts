/** Opt-in mission control over native storage-domain; Team tasks remain in their session journal. */
import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from './index.ts'
import type { SpawnTeammateRequest } from './types.ts'
import { TeamError } from './error.ts'

/** Loader entry name. */
export const name = 'team-mission-control'
/** Mission control requires native Team identity and durable domain storage. */
export const inject = ['agents', 'agentTeams', 'storageDomain']

/** Deployment bounds for this isolated control domain. */
export interface Config {
  domainName: string
  owner: string
  workspace: string
  maxCalls: number
  durationMs: number
  /** Require the host's persisted three-session composition before any model reservation. */
  hostComposition?: boolean
}

/** Explicit lab configuration; no production defaults or automatic activation. */
export const Config: schema<Config> = schema.object({
  domainName: schema.string().required(),
  owner: schema.string().required(),
  workspace: schema.string().required(),
  maxCalls: schema.number().step(1).min(1).required(),
  durationMs: schema.number().step(1).min(1).required(),
  hostComposition: schema.boolean().default(false),
})

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const identity = z.string().min(1).transform(SessionId)
const compositionRecord = z.object({
  state: z.enum(['provisioning', 'ready', 'failed']),
  bindings: z.object({ lead: identity, researcher: identity.optional(), checker: identity.optional() }).strict(),
  failure: z.string().max(1000).optional(),
}).strict().refine(value => value.state !== 'ready'
  || (value.bindings.researcher !== undefined && value.bindings.checker !== undefined
    && new Set(Object.values(value.bindings)).size === 3), 'ready composition requires three distinct identities')

/** Host-assigned functions; display names do not grant these capabilities. */
export interface TeamMissionBindings {
  readonly lead: SessionId
  readonly researcher: SessionId
  readonly checker: SessionId
}

/** Two initial requests provisioned by the host, never supplied through a model tool. */
export interface TeamMissionProvisionRequest {
  readonly researcher: SpawnTeammateRequest
  readonly checker: SpawnTeammateRequest
}
/** Durable control record; no tasks, messages or memory are duplicated here. */
export const missionRecord = z.object({
  rootId: z.string().min(1).transform(SessionId),
  owner: z.string().min(1),
  workspace: z.string().min(1),
  objective: z.string().trim().min(1).max(16000),
  criteria: z.string().trim().min(1).max(16000),
  revision: positive,
  state: z.enum(['running', 'paused', 'reviewing', 'cancelled', 'completed', 'blocked']),
  outcome: z.string().max(16000).optional(),
  calls: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxCalls: positive,
  deadline: positive,
  composition: compositionRecord.optional(),
}).strict().refine(value => value.calls <= value.maxCalls, 'mission calls exceed budget')

/** Current mission control state. */
export type TeamMissionRecord = z.infer<typeof missionRecord>

declare module '@deepseek-ai/cordis' {
  interface Context { teamMissions: TeamMissionControl }
  interface Events {
    /**
     * Notification after a durable mission control transition commits.
     * @param lead - exact authorized root Agent.
     * @param record - detached committed record, not a second source of truth.
     * @mode parallel
     */
    'team-mission/changed'(lead: Agent, record: TeamMissionRecord): Promise<void>
  }
}

/** Host-only state transitions and atomic reservations; not a model-facing authorization API. */
export class TeamMissionControl {
  private closed = false
  private readonly provisioning = new Map<SessionId, { controller: AbortController; done: Promise<void> }>()
  private readonly compositionWaiters = new Set<() => void>()

  /**
   * @param ctx - exact Team identity resolver.
   * @param table - sole authoritative control table, owned by this plugin.
   * @param config - trusted host scope and initial limits.
   */
  constructor(
    private readonly ctx: Context,
    private readonly table: KvTable<SessionId, TeamMissionRecord>,
    private readonly config: Config,
  ) {}

  /** Whether this isolated deployment requires host provisioning before model admission. */
  get requiresComposition(): boolean { return this.config.hostComposition === true }

  private wakeComposition(): void {
    for (const wake of this.compositionWaiters) wake()
  }

  private async publish(caller: Agent, record: TeamMissionRecord): Promise<void> {
    if (record.state !== 'running') this.provisioning.get(record.rootId)?.controller.abort(
      new TeamError(`Mission is ${record.state}`, 'MISSION_NOT_RUNNING'))
    this.wakeComposition()
    await this.ctx.parallel('team-mission/changed', caller, record)
  }

  private assertRunning(record: TeamMissionRecord): void {
    if (record.state !== 'running') throw new TeamError(`Mission is ${record.state}`, 'MISSION_NOT_RUNNING')
    if (Date.now() >= record.deadline) throw new TeamError('Mission deadline reached', 'MISSION_DEADLINE')
  }

  private assertHost(caller: Agent): SessionId {
    const id = this.root(caller)
    if (this.ctx.agents.currentInitiator() !== undefined) {
      throw new TeamError('Only the host can assign participant functions', 'MISSION_HOST_REQUIRED')
    }
    if (!this.requiresComposition) throw new TeamError('Host composition is not enabled', 'MISSION_COMPOSITION_DISABLED')
    return id
  }

  private bindings(caller: Agent, record: TeamMissionRecord): TeamMissionBindings {
    const composition = record.composition
    if (composition?.state !== 'ready' || composition.bindings.researcher === undefined
      || composition.bindings.checker === undefined) {
      throw new TeamError('Host composition is not ready', 'MISSION_COMPOSITION_INCOMPLETE')
    }
    const bindings = { lead: composition.bindings.lead, researcher: composition.bindings.researcher,
      checker: composition.bindings.checker }
    const members = this.ctx.agentTeams.listMembers(caller)
    if (bindings.lead !== caller.id || members.length !== 3 || new Set(Object.values(bindings)).size !== 3
      || Object.entries(bindings).some(([role, id]) => !members.some(member => member.id === id
        && member.role === (role === 'lead' ? 'lead' : 'teammate')
        && member.status !== 'failed' && member.status !== 'provisioning'))) {
      throw new TeamError('Persisted host functions do not match the exact native roster', 'MISSION_COMPOSITION_ROSTER')
    }
    return Object.freeze(bindings)
  }

  /**
   * Read and verify durable functional identities against the current native roster.
   * @param caller - exact live Lead, including after a cold resume.
   * @returns detached immutable host assignments; unready or changed rosters reject.
   */
  getComposition(caller: Agent): TeamMissionBindings { return this.bindings(caller, this.get(caller)) }

  private assertOfflineHost(id: SessionId, requireInactive: boolean): void {
    if (this.closed) throw new TeamError('Mission control is closed', 'MISSION_CLOSED')
    if (this.ctx.agents.currentInitiator() !== undefined) {
      throw new TeamError('Stored mission control is host-only', 'MISSION_HOST_REQUIRED')
    }
    if (requireInactive && this.ctx.agents.get(id) !== undefined) {
      throw new TeamError('Live missions require the live STOP controller', 'MISSION_LIVE_ROOT')
    }
  }

  /**
   * Inspect a stored mission without materializing an agent or draining its inbox.
   * @param id - root identity selected by the isolated, authenticated host entry.
   * @returns detached scope-checked control state; this read does not mutate or emit events.
   */
  inspectStored(id: SessionId): TeamMissionRecord {
    this.assertOfflineHost(id, false)
    return structuredClone(this.checked(this.table.get(id), id))
  }

  /**
   * Commit terminal STOP for an inactive root without loading any participant session.
   * The host must hold the same exclusive directory ownership used by the live runner.
   * @param id - root identity selected outside model/tool initiator scope.
   * @returns durable cancelled record; no lifecycle notification can activate pending inbox work.
   */
  async stopStored(id: SessionId): Promise<TeamMissionRecord> {
    this.assertOfflineHost(id, true)
    return this.table.mutate(id, (stored) => {
      this.assertOfflineHost(id, true)
      const current = this.checked(stored, id)
      if (current.state === 'cancelled') return { kind: 'keep', result: structuredClone(current) }
      const next = missionRecord.parse({ ...current, revision: current.revision + 1, state: 'cancelled' })
      return { kind: 'put', value: next, result: structuredClone(next) }
    })
  }

  /**
   * Provision exactly two native continuable workers before admitting model calls.
   * Failure retains every roster/session record and blocks the mission without renewing limits.
   * @param caller - exact Lead invoked outside model/tool initiator scope.
   * @param request - host-authored research and check requests; labels grant no authority.
   * @returns persisted function-to-session assignments after full roster validation.
   */
  async provisionTeam(caller: Agent, request: TeamMissionProvisionRequest): Promise<TeamMissionBindings> {
    const id = this.assertHost(caller)
    if (this.provisioning.has(id)) throw new TeamError('Host composition is already provisioning', 'MISSION_COMPOSITION_EXISTS')
    const controller = new AbortController()
    const settled = Promise.withResolvers<void>()
    this.provisioning.set(id, { controller, done: settled.promise })
    let started = false
    try {
      const initial = await this.table.mutate(id, (stored) => {
        const current = this.checked(stored, id)
        this.assertRunning(current)
        if (current.composition !== undefined || current.calls !== 0 || this.ctx.agentTeams.listMembers(caller).length !== 1) {
          throw new TeamError('Composition requires an unused mission and an empty native roster', 'MISSION_COMPOSITION_EXISTS')
        }
        const next = missionRecord.parse({ ...current, revision: current.revision + 1,
          composition: { state: 'provisioning', bindings: { lead: id } } })
        return { kind: 'put', value: next, result: structuredClone(next) }
      })
      started = true
      await this.publish(caller, initial)
      for (const role of ['researcher', 'checker'] as const) {
        this.assertHost(caller)
        this.assertRunning(this.get(caller))
        const signal = AbortSignal.any([request[role].signal, controller.signal,
          AbortSignal.timeout(Math.max(1, Math.min(2147483647, initial.deadline - Date.now())))])
        const result = await this.ctx.agentTeams.spawnTeammate(caller, { ...request[role], signal })
        const bound = await this.table.mutate(id, (stored) => {
          const current = this.checked(stored, id)
          this.assertRunning(current)
          if (current.composition?.state !== 'provisioning' || current.calls !== 0) {
            throw new TeamError('Composition changed during provisioning', 'MISSION_COMPOSITION_CONFLICT')
          }
          const next = missionRecord.parse({ ...current, revision: current.revision + 1,
            composition: { ...current.composition, bindings: { ...current.composition.bindings, [role]: result.member.id } } })
          return { kind: 'put', value: next, result: structuredClone(next) }
        })
        await this.publish(caller, bound)
      }
      const ready = await this.table.mutate(id, (stored) => {
        const current = this.checked(stored, id)
        this.assertRunning(current)
        if (current.composition?.state !== 'provisioning' || current.calls !== 0) {
          throw new TeamError('Composition changed before activation', 'MISSION_COMPOSITION_CONFLICT')
        }
        const next = missionRecord.parse({ ...current, revision: current.revision + 1,
          composition: { ...current.composition, state: 'ready' } })
        this.bindings(caller, next)
        return { kind: 'put', value: next, result: structuredClone(next) }
      })
      await this.publish(caller, ready)
      return this.bindings(caller, ready)
    } catch (error: unknown) {
      if (started) {
        const failed = await this.table.mutate(id, (stored) => {
          const current = this.checked(stored, id)
          if (current.composition?.state !== 'provisioning') return { kind: 'keep', result: structuredClone(current) }
          const next = missionRecord.parse({ ...current, revision: current.revision + 1,
            state: current.state === 'running' ? 'blocked' : current.state,
            composition: { ...current.composition, state: 'failed', failure: 'Host provisioning failed; native sessions and original limits are retained.' } })
          return { kind: 'put', value: next, result: structuredClone(next) }
        })
        await this.publish(caller, failed)
      }
      throw error
    } finally {
      this.provisioning.delete(id)
      settled.resolve()
      this.wakeComposition()
    }
  }

  /**
   * Wait after message durability but before reservation/inference for host composition.
   * @param caller - exact current Lead resolved from the requesting participant.
   * @param signal - request cancellation; the original mission deadline also bounds waiting.
   * @returns validated function assignments; STOP, orphan provisioning, failure and extras reject.
   */
  async waitForComposition(caller: Agent, signal: AbortSignal): Promise<TeamMissionBindings> {
    const deadline = this.get(caller).deadline
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(2147483647, deadline - Date.now())))])
    while (true) {
      bounded.throwIfAborted()
      const current = this.get(caller)
      this.assertRunning(current)
      if (current.composition?.state === 'ready') return this.bindings(caller, current)
      if (current.composition?.state !== 'provisioning' || !this.provisioning.has(caller.id)) {
        throw new TeamError('Host composition is missing, failed or orphaned; no inference admitted', 'MISSION_COMPOSITION_INCOMPLETE')
      }
      await new Promise<void>((resolveWait, reject) => {
        const finish = () => { this.compositionWaiters.delete(wake); bounded.removeEventListener('abort', abort) }
        const wake = () => { finish(); resolveWait() }
        const abort = () => { finish(); reject(bounded.reason instanceof Error ? bounded.reason
          : new TeamError('Composition wait aborted', 'MISSION_COMPOSITION_ABORTED')) }
        this.compositionWaiters.add(wake)
        bounded.addEventListener('abort', abort, { once: true })
        if (bounded.aborted) abort()
      })
    }
  }

  private root(caller: Agent): SessionId {
    if (this.closed) throw new TeamError('Mission control is closed', 'MISSION_CLOSED')
    const membership = this.ctx.agentTeams.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('Only the host Lead can control a mission', 'TEAM_LEAD_REQUIRED')
    if (membership.root.session.header.cwd === undefined
      || resolve(membership.root.session.header.cwd) !== resolve(this.config.workspace)) {
      throw new TeamError('Lead workspace differs from mission scope', 'MISSION_SCOPE_MISMATCH')
    }
    return membership.root.id
  }

  private checked(record: TeamMissionRecord | undefined, id: SessionId): TeamMissionRecord {
    if (record === undefined) throw new TeamError('Mission has not been authorized', 'MISSION_NOT_FOUND')
    if (record.rootId !== id || record.owner !== this.config.owner || record.workspace !== this.config.workspace) {
      throw new TeamError('Mission belongs to another owner or workspace', 'MISSION_SCOPE_MISMATCH')
    }
    return record
  }

  /**
   * Start one host-authorized mission; a root can never reset its consumed budget.
   * @param caller - exact live Lead; caller authentication remains the host entry's responsibility.
   * @param objective - authorized outcome, not a worker instruction.
   * @param criteria - frozen acceptance text; cannot be edited through this API.
   * @returns durable initial record; duplicate starts reject.
   */
  async start(caller: Agent, objective: string, criteria: string): Promise<TeamMissionRecord> {
    const id = this.root(caller)
    const candidate = missionRecord.parse({
      rootId: id, owner: this.config.owner, workspace: this.config.workspace, objective, criteria,
      revision: 1, state: 'running', calls: 0, maxCalls: this.config.maxCalls,
      deadline: Date.now() + this.config.durationMs,
    })
    const record = await this.table.mutate(id, (current) => {
      if (current !== undefined) throw new TeamError('This root already owns a mission', 'MISSION_ALREADY_EXISTS')
      return { kind: 'put', value: candidate, result: structuredClone(candidate) }
    })
    await this.publish(caller, record)
    return record
  }

  /**
   * Read detached control state without exposing another configured workspace.
   * @param caller - exact live Lead.
   * @returns current durable control state.
   */
  get(caller: Agent): TeamMissionRecord {
    const id = this.root(caller)
    return structuredClone(this.checked(this.table.get(id), id))
  }

  /**
   * Persist pause, terminal STOP, or an explicit resume from paused only.
   * This transition does not itself cancel an in-flight model or subprocess.
   * @param caller - exact live Lead used by the authenticated host control.
   * @param revision - observed revision for pause/resume; terminal STOP uses the latest committed record.
   * @param action - host control action; cancelled missions cannot resume.
   * @returns committed record, without resetting deadline, criteria or counters.
   */
  async transition(caller: Agent, revision: number, action: 'pause' | 'stop' | 'resume'): Promise<TeamMissionRecord> {
    const id = this.root(caller)
    const record = await this.table.mutate(id, (stored) => {
      const current = this.checked(stored, id)
      if (action !== 'stop' && current.revision !== revision) throw new TeamError('Mission revision changed', 'MISSION_STALE_REVISION')
      if (current.state === 'cancelled') throw new TeamError('STOP is terminal for this mission', 'MISSION_CANCELLED')
      if (action === 'resume' && current.state !== 'paused') throw new TeamError('Only a paused mission can resume', 'MISSION_INVALID_TRANSITION')
      if (action === 'pause' && current.state !== 'running') throw new TeamError('Only a running mission can pause', 'MISSION_INVALID_TRANSITION')
      const next = missionRecord.parse({ ...current, revision: current.revision + 1,
        state: action === 'stop' ? 'cancelled' : action === 'pause' ? 'paused' : 'running' })
      return { kind: 'put', value: next, result: structuredClone(next) }
    })
    await this.publish(caller, record)
    return record
  }

  /**
   * Durably spend one attempt before dispatch; failed calls are not refunded.
   * @param caller - exact Lead selected by the runtime's mission resolver.
   * @returns committed reservation number; paused, cancelled, expired or exhausted missions reject.
   */
  async reserveCall(caller: Agent): Promise<number> {
    const id = this.root(caller)
    return this.table.mutate(id, (stored) => {
      const current = this.checked(stored, id)
      this.assertRunning(current)
      if (this.requiresComposition) this.bindings(caller, current)
      if (current.calls >= current.maxCalls) throw new TeamError('Mission call budget exhausted', 'MISSION_BUDGET_EXHAUSTED')
      const next = missionRecord.parse({ ...current, revision: current.revision + 1, calls: current.calls + 1 })
      return { kind: 'put', value: next, result: next.calls }
    })
  }

  /**
   * Commit a host-verified outcome without granting a model an approval tool.
   * @param caller - exact live Lead controlled by the host runner.
   * @param verify - trusted verifier of current artifacts and native task evidence.
   * @returns committed outcome; verifier exceptions pause without approval or budget renewal, and concurrent controls win.
   */
  async finish(caller: Agent, verify: () => Promise<{ passed: boolean; summary: string }>): Promise<TeamMissionRecord> {
    const id = this.root(caller)
    const frozen = await this.table.mutate(id, (stored) => {
      const current = this.checked(stored, id)
      if (current.state !== 'running') throw new TeamError('Mission is not running', 'MISSION_NOT_RUNNING')
      const next = missionRecord.parse({ ...current, revision: current.revision + 1, state: 'reviewing' })
      return { kind: 'put', value: next, result: structuredClone(next) }
    })
    // Close inference admission before reading evidence; a late worker cannot race this review.
    let proof: { passed: boolean; summary: string }
    try {
      await this.publish(caller, frozen)
      proof = await verify()
    } catch {
      // Verifier and admission-drain failures must leave a recoverable, unapproved state.
      const paused = await this.table.mutate(id, (stored) => {
        const current = this.checked(stored, id)
        if (current.revision !== frozen.revision) throw new TeamError('Mission changed during review', 'MISSION_STALE_REVISION')
        const next = missionRecord.parse({ ...current, revision: current.revision + 1, state: 'paused',
          outcome: 'Evidence review failed. No completion approved; inspect the artifacts before resuming.' })
        return { kind: 'put', value: next, result: structuredClone(next) }
      })
      await this.publish(caller, paused)
      return paused
    }
    const result = await this.table.mutate(id, (stored) => {
      const current = this.checked(stored, id)
      if (current.revision !== frozen.revision) throw new TeamError('Mission changed during review', 'MISSION_STALE_REVISION')
      const next = missionRecord.parse({ ...current, revision: current.revision + 1,
        state: proof.passed && Date.now() < current.deadline ? 'completed' : 'blocked', outcome: proof.summary })
      return { kind: 'put', value: next, result: structuredClone(next) }
    })
    await this.publish(caller, result)
    return result
  }

  /**
   * Reject new control calls and await admitted provisioning before closing its storage.
   * @returns once every admitted provisioning operation has settled.
   */
  async close(): Promise<void> {
    this.closed = true
    const pending = [...this.provisioning.values()]
    for (const operation of pending) operation.controller.abort(new TeamError('Mission control is closed', 'MISSION_CLOSED'))
    this.wakeComposition()
    await Promise.all(pending.map(operation => operation.done))
  }
}

/**
 * Mount the optional control entry over the configured native backend.
 * @param ctx - Loader context; no task driver or model route is installed here.
 * @param config - trusted lab-only scope and bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  positive.parse(config.maxCalls)
  positive.parse(config.durationMs)
  z.string().trim().min(1).parse(config.owner)
  z.string().trim().min(1).parse(config.workspace)
  if (!isAbsolute(config.workspace)) throw new TeamError('Mission workspace must be absolute', 'MISSION_SCOPE_MISMATCH')
  const domain = await ctx.storageDomain.open(defineDomain({
    name: config.domainName, version: 1,
    tables: { missions: domainTable<SessionId, TeamMissionRecord>(missionRecord) },
  }))
  const service = new TeamMissionControl(ctx, domain.table('missions'), config)
  ctx.effect(() => async () => { await service.close(); await domain.close() }, 'teamMissions.domain()')
  ctx.provide('teamMissions', service)
}
