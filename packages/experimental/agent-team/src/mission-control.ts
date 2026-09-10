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
import { TeamError } from './error.ts'

/** Loader entry name. */
export const name = 'team-mission-control'
/** Mission control requires native Team identity and durable domain storage. */
export const inject = ['agentTeams', 'storageDomain']

/** Deployment bounds for this isolated control domain. */
export interface Config {
  domainName: string
  owner: string
  workspace: string
  maxCalls: number
  durationMs: number
}

/** Explicit lab configuration; no production defaults or automatic activation. */
export const Config: schema<Config> = schema.object({
  domainName: schema.string().required(),
  owner: schema.string().required(),
  workspace: schema.string().required(),
  maxCalls: schema.number().step(1).min(1).required(),
  durationMs: schema.number().step(1).min(1).required(),
})

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
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
    await this.ctx.parallel('team-mission/changed', caller, record)
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
    await this.ctx.parallel('team-mission/changed', caller, record)
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
      if (current.state !== 'running') throw new TeamError(`Mission is ${current.state}`, 'MISSION_NOT_RUNNING')
      if (Date.now() >= current.deadline) throw new TeamError('Mission deadline reached', 'MISSION_DEADLINE')
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
      await this.ctx.parallel('team-mission/changed', caller, frozen)
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
      await this.ctx.parallel('team-mission/changed', caller, paused)
      return paused
    }
    const result = await this.table.mutate(id, (stored) => {
      const current = this.checked(stored, id)
      if (current.revision !== frozen.revision) throw new TeamError('Mission changed during review', 'MISSION_STALE_REVISION')
      const next = missionRecord.parse({ ...current, revision: current.revision + 1,
        state: proof.passed && Date.now() < current.deadline ? 'completed' : 'blocked', outcome: proof.summary })
      return { kind: 'put', value: next, result: structuredClone(next) }
    })
    await this.ctx.parallel('team-mission/changed', caller, result)
    return result
  }

  /** Reject future control calls when the plugin begins disposal. */
  close(): void { this.closed = true }
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
  ctx.effect(() => () => { service.close(); return domain.close() }, 'teamMissions.domain()')
  ctx.provide('teamMissions', service)
}
