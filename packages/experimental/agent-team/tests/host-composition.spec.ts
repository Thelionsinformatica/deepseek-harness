import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Teams from '../src/index.ts'
import * as Missions from '../src/mission-control.ts'
import * as Execution from '../src/execution.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

async function boot(workspace: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(workspace, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Teams, { maxMembers: 3, completionRequiresReview: true })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(workspace, 'control') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Missions, { domainName: 'host_composition', owner: 'host-test', workspace,
    maxCalls: 48, durationMs: 900000, hostComposition: true })
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 128,
    queueTimeoutMs: 2000, allowedTools: [], reviewReserve: { calls: 8, reviewerRole: 'checker' } })
  const adapter = new MockAdapter(Array.from({ length: 12 }, () => textResponse('observed turn')))
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

async function setup(existing?: string) {
  const workspace = existing ?? await mkdtemp(join(tmpdir(), 'leon-host-composition-'))
  if (existing === undefined) directories.push(workspace)
  const { ctx, adapter } = await boot(workspace)
  const lead = existing === undefined
    ? ctx.agentLoop.create(SessionId('host-root'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
    : (await ctx.agentLoop.resume(ctx, { resumeSessionId: SessionId('host-root'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  if (existing === undefined) await ctx.teamMissions.start(lead, 'Isolated proof', 'Current evidence is required')
  const request = (name: string) => ({ name, description: name, prompt: [{ type: 'text' as const, text: 'Inspect only' }],
    context: 'fresh' as const, provider: 'spawn', signal: new AbortController().signal })
  return { ctx, lead, adapter, workspace, request }
}

function message(text: string) { return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }) }

it('persists host functions before first inference even when display names claim the other function', async () => {
  const { ctx, lead, adapter, request } = await setup()
  const original = ctx.agentTeams.spawnTeammate.bind(ctx.agentTeams)
  const secondEntered = Promise.withResolvers<undefined>()
  const secondRelease = Promise.withResolvers<undefined>()
  let creations = 0
  vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockImplementation(async (caller, spec) => {
    if (++creations === 2) { secondEntered.resolve(undefined); await secondRelease.promise }
    return original(caller, spec)
  })
  const initial = ctx.teamMissions.get(lead)
  const provision = ctx.teamMissions.provisionTeam(lead, { researcher: request('checker'), checker: request('researcher') })
  await secondEntered.promise
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(2)
  expect(adapter.requests).toHaveLength(0)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ calls: 0, deadline: initial.deadline, composition: { state: 'provisioning' } })
  await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_COMPOSITION_INCOMPLETE' })
  secondRelease.resolve(undefined)
  const bindings = await provision
  expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'checker')?.id).toBe(bindings.researcher)
  expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'researcher')?.id).toBe(bindings.checker)
  for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  expect(ctx.teamMissions.getComposition(lead)).toEqual(bindings)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ calls: 2, maxCalls: 48, deadline: initial.deadline, composition: { state: 'ready' } })
  await expect(ctx.teamMissions.provisionTeam(lead, { researcher: request('new-one'), checker: request('new-two') }))
    .rejects.toMatchObject({ code: 'MISSION_COMPOSITION_EXISTS' })
  await ctx.sessions.flush(lead.session)
  const stored = await ctx.sessionPersistence.inspect(lead.id, new AbortController().signal)
  expect(stored.events.filter(event => event.type === 'team/member' && event.data.member.phase === 'active')).toHaveLength(2)
})

it('admits only the host-assigned checker in the final eight calls', async () => {
  const { ctx, lead, adapter, request } = await setup()
  const bindings = await ctx.teamMissions.provisionTeam(lead, { researcher: request('checker'), checker: request('worker') })
  for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
  while (ctx.teamMissions.get(lead).calls < 40) await ctx.teamMissions.reserveCall(lead)
  const before = adapter.requests.length
  const denied = await ctx.subagents.followup(lead, bindings.researcher, [{ type: 'text', text: 'Investigate again' }],
    { source: { kind: 'user' }, signal: new AbortController().signal })
  expect(denied).toBeDefined()
  await ctx.agents.get(bindings.researcher)?.whenIdle()
  expect(adapter.requests).toHaveLength(before)
  await ctx.subagents.followup(lead, bindings.checker, [{ type: 'text', text: 'Verify current result' }],
    { source: { kind: 'user' }, signal: new AbortController().signal })
  await ctx.agents.get(bindings.checker)?.whenIdle()
  expect(adapter.requests).toHaveLength(before + 1)
  expect(ctx.teamMissions.get(lead).calls).toBe(41)
})

it('blocks participant self-assignment and missing host setup before a model request', async () => {
  const { ctx, lead, adapter, request } = await setup()
  await ctx.agents.withInitiator(lead, async () => {
    await expect(ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') }))
      .rejects.toMatchObject({ code: 'MISSION_HOST_REQUIRED' })
  })
  lead.followup(message('Run without a host roster'))
  await lead.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(ctx.teamMissions.get(lead).calls).toBe(0)
})

it('preserves STOP, deadline and failed provisioning across reload instead of manufacturing a live team', async () => {
  const { ctx, lead, adapter, request, workspace } = await setup()
  const original = ctx.agentTeams.spawnTeammate.bind(ctx.agentTeams)
  const secondEntered = Promise.withResolvers<undefined>()
  const secondRelease = Promise.withResolvers<undefined>()
  let count = 0
  vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockImplementation(async (caller, spec) => {
    if (++count === 2) { secondEntered.resolve(undefined); await secondRelease.promise }
    return original(caller, spec)
  })
  const initial = ctx.teamMissions.get(lead)
  const provision = ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') })
  const rejected = expect(provision).rejects.toBeDefined()
  await secondEntered.promise
  await ctx.teamMissions.transition(lead, initial.revision, 'stop')
  secondRelease.resolve(undefined)
  await rejected
  expect(adapter.requests).toHaveLength(0)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ state: 'cancelled', calls: 0, deadline: initial.deadline,
    composition: { state: 'failed' } })
  await ctx.sessions.flush(lead.session)
  await ctx.fiber.dispose()
  const resumed = await setup(workspace)
  expect(resumed.ctx.teamMissions.get(resumed.lead)).toMatchObject({ state: 'cancelled', calls: 0,
    deadline: initial.deadline, composition: { state: 'failed' } })
  await expect(resumed.ctx.teamMissions.waitForComposition(resumed.lead, new AbortController().signal))
    .rejects.toMatchObject({ code: 'MISSION_NOT_RUNNING' })
  await expect(resumed.ctx.teamMissions.transition(resumed.lead, resumed.ctx.teamMissions.get(resumed.lead).revision, 'resume'))
    .rejects.toMatchObject({ code: 'MISSION_CANCELLED' })
})

it('rejects extra native members after the persisted composition is ready', async () => {
  const { ctx, lead, adapter, request } = await setup()
  const bindings = await ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') })
  for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
  const before = adapter.requests.length
  const extra = await ctx.agentTeams.spawnTeammate(lead, request('extra-member'))
  await ctx.agents.get(extra.member.id)?.whenIdle()
  expect(adapter.requests).toHaveLength(before)
  expect(() => ctx.teamMissions.getComposition(lead)).toThrow('exact native roster')
  await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_COMPOSITION_ROSTER' })
})

it('restores the same host functions from the mission domain after all child activations leave', async () => {
  const { ctx, lead, request, workspace } = await setup()
  const bindings = await ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') })
  for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
  await vi.waitFor(() => {
    expect(ctx.agents.get(bindings.researcher)).toBeUndefined()
    expect(ctx.agents.get(bindings.checker)).toBeUndefined()
  })
  await lead.whenIdle()
  const before = await ctx.teamMissions.transition(lead, ctx.teamMissions.get(lead).revision, 'pause')
  await ctx.sessions.flush(lead.session)
  await ctx.fiber.dispose()
  const resumed = await setup(workspace)
  expect(resumed.ctx.teamMissions.getComposition(resumed.lead)).toEqual(bindings)
  expect(resumed.ctx.teamMissions.get(resumed.lead)).toMatchObject({ calls: before.calls, deadline: before.deadline,
    composition: before.composition })
  expect(resumed.adapter.requests).toHaveLength(0)
  await resumed.ctx.teamMissions.transition(resumed.lead, before.revision, 'resume')
  await resumed.ctx.subagents.followup(resumed.lead, bindings.checker, [{ type: 'text', text: 'Resume review' }],
    { source: { kind: 'user' }, signal: new AbortController().signal })
  await resumed.ctx.agents.get(bindings.checker)?.whenIdle()
  expect(resumed.adapter.requests.filter(entry => entry.sessionId === bindings.checker)).toHaveLength(1)
  expect(resumed.ctx.teamMissions.get(resumed.lead).calls).toBeGreaterThanOrEqual(before.calls + 1)
})

it('classifies persisted orphan provisioning as incomplete without spending or recreating a worker', async () => {
  const { ctx, lead, workspace } = await setup()
  const original = ctx.teamMissions.get(lead)
  lead.followup(message('Await host composition'))
  await lead.whenIdle()
  await ctx.sessions.flush(lead.session)
  await ctx.fiber.dispose()
  const controlPath = join(workspace, 'control', 'host_composition.json')
  const stored = JSON.parse(await readFile(controlPath, 'utf8')) as { tables: { missions: Record<string, Missions.TeamMissionRecord> } }
  const record = stored.tables.missions[lead.id]
  if (record === undefined) throw new Error('Missing control fixture')
  record.composition = { state: 'provisioning', bindings: { lead: lead.id } }
  await writeFile(controlPath, JSON.stringify(stored))
  const resumed = await setup(workspace)
  await expect(resumed.ctx.teamMissions.waitForComposition(resumed.lead, new AbortController().signal))
    .rejects.toMatchObject({ code: 'MISSION_COMPOSITION_INCOMPLETE' })
  await expect(resumed.ctx.teamMissions.provisionTeam(resumed.lead,
    { researcher: resumed.request('researcher'), checker: resumed.request('checker') }))
    .rejects.toMatchObject({ code: 'MISSION_COMPOSITION_EXISTS' })
  expect(resumed.ctx.agentTeams.listMembers(resumed.lead)).toHaveLength(1)
  expect(resumed.adapter.requests).toHaveLength(0)
  expect(resumed.ctx.teamMissions.get(resumed.lead)).toMatchObject({ calls: 0, deadline: original.deadline,
    composition: { state: 'provisioning' } })
})

it('awaits cancelled provisioning before closing its control storage', async () => {
  const { ctx, lead, adapter, request, workspace } = await setup()
  const original = ctx.agentTeams.spawnTeammate.bind(ctx.agentTeams)
  const entered = Promise.withResolvers<undefined>()
  let count = 0
  vi.spyOn(ctx.agentTeams, 'spawnTeammate').mockImplementation(async (caller, spec) => {
    if (++count === 2) {
      entered.resolve(undefined)
      await new Promise<never>((_resolve, reject) => {
        const abort = () => { reject(new Error('Host cancelled fixture preparation')) }
        spec.signal.addEventListener('abort', abort, { once: true })
        if (spec.signal.aborted) abort()
      })
    }
    return original(caller, spec)
  })
  const provision = ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') })
  const rejected = expect(provision).rejects.toThrow('Host cancelled fixture preparation')
  await entered.promise
  await ctx.teamMissions.close()
  await rejected
  expect(adapter.requests).toHaveLength(0)
  const stored = JSON.parse(await readFile(join(workspace, 'control', 'host_composition.json'), 'utf8')) as {
    tables: { missions: Record<string, Missions.TeamMissionRecord> }
  }
  expect(stored.tables.missions[lead.id]).toMatchObject({ calls: 0, state: 'blocked', composition: { state: 'failed' } })
})

it('inspects and stops an offline mission without loading any agent, request or pending inbox', async () => {
  const { ctx, lead, request, workspace } = await setup()
  const bindings = await ctx.teamMissions.provisionTeam(lead, { researcher: request('researcher'), checker: request('checker') })
  for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
  await vi.waitFor(() => {
    expect(ctx.agents.get(bindings.researcher)).toBeUndefined()
    expect(ctx.agents.get(bindings.checker)).toBeUndefined()
  })
  await lead.whenIdle()
  const paused = await ctx.teamMissions.transition(lead, ctx.teamMissions.get(lead).revision, 'pause')
  await ctx.sessions.flush(lead.session)
  await ctx.fiber.dispose()
  const offline = await boot(workspace)
  const controlPath = join(workspace, 'control', 'host_composition.json')
  const bytes = await readFile(controlPath, 'utf8')
  expect(offline.ctx.teamMissions.inspectStored(lead.id)).toMatchObject(paused)
  expect(await readFile(controlPath, 'utf8')).toBe(bytes)
  expect(offline.ctx.agents.list()).toHaveLength(0)
  const events: unknown[] = []
  offline.ctx.on('team-mission/changed', (_agent, value) => { events.push(value); return Promise.resolve() })
  const stopped = await offline.ctx.teamMissions.stopStored(lead.id)
  expect(stopped).toMatchObject({ state: 'cancelled', calls: paused.calls, deadline: paused.deadline, composition: paused.composition })
  expect(events).toEqual([])
  expect(offline.ctx.agents.list()).toHaveLength(0)
  expect(offline.adapter.requests).toHaveLength(0)
  expect(await offline.ctx.teamMissions.stopStored(lead.id)).toEqual(stopped)
  await offline.ctx.fiber.dispose()
  const reloaded = await boot(workspace)
  expect(reloaded.ctx.teamMissions.inspectStored(lead.id)).toEqual(stopped)
  expect(reloaded.ctx.agents.list()).toHaveLength(0)
  expect(reloaded.adapter.requests).toHaveLength(0)
})

it('refuses offline STOP against a live root or a model-initiated stored operation', async () => {
  const { ctx, lead } = await setup()
  await expect(ctx.teamMissions.stopStored(lead.id)).rejects.toMatchObject({ code: 'MISSION_LIVE_ROOT' })
  await ctx.agents.withInitiator(lead, async () => {
    expect(() => ctx.teamMissions.inspectStored(lead.id)).toThrow('host-only')
    await expect(ctx.teamMissions.stopStored(lead.id)).rejects.toMatchObject({ code: 'MISSION_HOST_REQUIRED' })
  })
  expect(ctx.teamMissions.get(lead)).toMatchObject({ state: 'running', calls: 0 })
})
