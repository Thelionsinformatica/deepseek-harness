import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
import Teams from '../src/index.ts'
import * as Missions from '../src/mission-control.ts'
import * as Execution from '../src/execution.ts'
import * as ImportLab from '../src/import-lab.ts'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const directories: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'leon-missions-'))
  directories.push(path)
  return path
}

async function setup(path: string, overrides: Partial<Missions.Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(path, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(Teams, { completionRequiresReview: true })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(path, 'control') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = await ctx.plugin(Missions, {
    domainName: 'leon_collective', owner: 'lab-owner', workspace: path,
    maxCalls: 2, durationMs: 60000, ...overrides,
  })
  const lead = ctx.agentLoop.create(SessionId('mission-root'), { provider: 'mock', model: 'mock' }, { cwd: path })
  return { ctx, lead, fiber }
}

it('refuses completion when the verifier fails and preserves its evidence', async () => {
  const { ctx, lead } = await setup(await directory())
  await ctx.teamMissions.start(lead, 'Proof', 'Must pass')
  expect(await ctx.teamMissions.finish(lead, async () => ({ passed: false, summary: 'actual count 4, expected 2' })))
    .toMatchObject({ state: 'blocked', outcome: 'actual count 4, expected 2' })
})

it('closes inference admission before checking completion evidence', async () => {
  const { ctx, lead } = await setup(await directory())
  await ctx.teamMissions.start(lead, 'Review', 'Frozen evidence')
  const result = await ctx.teamMissions.finish(lead, async () => {
    expect(ctx.teamMissions.get(lead).state).toBe('reviewing')
    await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_NOT_RUNNING' })
    return { passed: true, summary: 'verified' }
  })
  expect(result.state).toBe('completed')
})

it('accepts STOP with an old revision after concurrent inference reservations', async () => {
  const { ctx, lead } = await setup(await directory())
  const initial = await ctx.teamMissions.start(lead, 'Stop race', 'No later calls')
  const reservation = ctx.teamMissions.reserveCall(lead)
  const stopped = ctx.teamMissions.transition(lead, initial.revision, 'stop')
  await reservation
  expect(await stopped).toMatchObject({ state: 'cancelled', calls: 1 })
  await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_NOT_RUNNING' })
})

it('pauses a throwing verifier and resumes without renewing the mission budget', async () => {
  const { ctx, lead } = await setup(await directory())
  const initial = await ctx.teamMissions.start(lead, 'Review recovery', 'Verified output')
  await ctx.teamMissions.reserveCall(lead)
  const failed = await ctx.teamMissions.finish(lead, async () => { throw new Error('private I/O details') })
  expect(failed).toMatchObject({ state: 'paused', calls: 1, deadline: initial.deadline })
  expect(failed.outcome).not.toContain('private I/O details')
  await ctx.teamMissions.transition(lead, failed.revision, 'resume')
  expect(await ctx.teamMissions.finish(lead, async () => ({ passed: true, summary: 'rechecked' })))
    .toMatchObject({ state: 'completed', calls: 1, deadline: initial.deadline })
})

it('preserves STOP when a concurrent verifier throws', async () => {
  const { ctx, lead } = await setup(await directory())
  await ctx.teamMissions.start(lead, 'Stop during review', 'No approval')
  await expect(ctx.teamMissions.finish(lead, async () => {
    await ctx.teamMissions.transition(lead, 1, 'stop')
    throw new Error('verification interrupted')
  })).rejects.toMatchObject({ code: 'MISSION_STALE_REVISION' })
  expect(ctx.teamMissions.get(lead).state).toBe('cancelled')
})

it('patches only the current fixture digest and verifies idempotent import', async () => {
  const workspace = await directory()
  const { ctx, lead } = await setup(workspace)
  await writeFile(join(workspace, 'import-policy.json'), '{"mode":"append"}\n')
  await ctx.plugin(ImportLab, { workspace })
  await ctx.teamMissions.start(lead, 'Import', 'Idempotent')
  const original = await ImportLab.readImportPolicy(workspace)
  expect((await ImportLab.verifyImportPolicy(workspace)).passed).toBe(false)
  const execute = (expected_digest: string) => ctx.tools.execute({ agent: lead, callId: CallId('patch-fixture'),
    name: 'mission_patch', arguments: { expected_digest, mode: 'upsert' }, signal: new AbortController().signal })
  expect((await execute(original.digest)).isError).toBeFalsy()
  expect((await ImportLab.verifyImportPolicy(workspace)).passed).toBe(true)
  expect((await execute(original.digest)).isError).toBe(true)
  expect((await readdir(workspace)).filter(file => file.endsWith('.tmp'))).toEqual([])
})

it('deduplicates concurrent worker task starts and refuses submission without evidence', async () => {
  const workspace = await directory()
  const { ctx, lead } = await setup(workspace)
  await writeFile(join(workspace, 'import-policy.json'), '{"mode":"append"}\n')
  await ctx.plugin(ImportLab, { workspace })
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang']))
  await ctx.teamMissions.start(lead, 'Worker task', 'Proof')
  const signal = new AbortController().signal
  const spawned = await ctx.agentTeams.spawnTeammate(lead, { name: 'worker', description: 'Test',
    prompt: [{ type: 'text', text: 'Wait' }], context: 'fresh', provider: 'spawn', signal })
  const worker = ctx.agents.get(spawned.member.id)
  if (worker === undefined) throw new Error('Missing worker')
  const execute = (phase: string, index: number) => ctx.tools.execute({ agent: worker, callId: CallId(`task-${index}`),
    name: 'mission_task', arguments: { phase }, signal })
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => execute('start', index)))
  expect(results.every(result => !result.isError)).toBe(true)
  expect(ctx.agentTeams.listTasks(lead)).toHaveLength(1)
  expect((await execute('complete', 7)).isError).toBe(true)
  const alias = await ctx.tools.execute({ agent: worker, callId: CallId('task-alias'),
    name: 'mission_task_complete', arguments: { phase: 'complete' }, signal })
  expect(alias.isError).toBe(true)
  expect(ctx.agentTeams.listTasks(lead)[0]?.status).toBe('in_progress')
})

it('does not overwrite STOP with an in-flight successful review', async () => {
  const { ctx, lead } = await setup(await directory())
  await ctx.teamMissions.start(lead, 'Proof', 'Must pass')
  await expect(ctx.teamMissions.finish(lead, async () => {
    await ctx.teamMissions.transition(lead, ctx.teamMissions.get(lead).revision, 'stop')
    return { passed: true, summary: 'late result' }
  })).rejects.toMatchObject({ code: 'MISSION_STALE_REVISION' })
  expect(ctx.teamMissions.get(lead).state).toBe('cancelled')
})

it('blocks an unapproved route before invoking the adapter', async () => {
  const { ctx, lead } = await setup(await directory())
  const adapter = new MockAdapter([textResponse('must not run')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(Execution, { provider: 'other', model: 'mock', maxOutputTokens: 100, queueTimeoutMs: 1000, allowedTools: [] })
  await ctx.teamMissions.start(lead, 'Route', 'Local only')
  lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }))
  await lead.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(ctx.teamMissions.get(lead).calls).toBe(0)
})

it('yields a repetitive turn without granting new mission budget', async () => {
  const { ctx, lead } = await setup(await directory())
  const adapter = new MockAdapter([toolCallResponse('attempt', 'missing', {}), textResponse('must not run')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 100,
    queueTimeoutMs: 1000, allowedTools: [], turnStepLimit: 1 })
  await ctx.teamMissions.start(lead, 'Bounded turn', 'Reviewer receives control')
  lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }))
  await lead.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ calls: 1, maxCalls: 2 })
})

it('rechecks review allowance for concurrent streams after acquiring the slot', async () => {
  const { ctx, lead } = await setup(await directory(), { maxCalls: 3 })
  const adapter = new MockAdapter([textResponse('one'), textResponse('two'), textResponse('forbidden')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 100,
    queueTimeoutMs: 1000, allowedTools: [], reviewReserve: { calls: 1, reviewerName: 'checker' } })
  await ctx.teamMissions.start(lead, 'Concurrent review reserve', 'Keep final call')
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => ctx.agents.withInitiator(lead, async () => {
    for await (const chunk of ctx.llm.stream({ provider: 'mock', model: 'mock', maxTokens: 100,
      messages: [], signal: AbortSignal.timeout(1000) })) void chunk
  })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
  expect(adapter.requests).toHaveLength(2)
  expect(ctx.teamMissions.get(lead).calls).toBe(2)
})

it('preserves the final reservation for a real reviewer after denying the lead', async () => {
  const { ctx, lead } = await setup(await directory(), { maxCalls: 3 })
  const adapter = new MockAdapter([textResponse('one'), textResponse('two'), textResponse('review')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 100,
    queueTimeoutMs: 1000, allowedTools: [], reviewReserve: { calls: 1, reviewerName: 'checker' } })
  await ctx.teamMissions.start(lead, 'Reserved review', 'No lead spending final call')
  for (let i = 0; i < 4; i++) {
    lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }))
    await lead.whenIdle()
  }
  expect(adapter.requests).toHaveLength(2)
  expect(ctx.teamMissions.get(lead).calls).toBe(2)
  const spawned = await ctx.agentTeams.spawnTeammate(lead, { name: 'checker', description: 'Review',
    prompt: [{ type: 'text', text: 'Review' }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal })
  const worker = ctx.agents.get(spawned.member.id)
  if (worker) await worker.whenIdle()
  expect(adapter.requests).toHaveLength(3)
  expect(ctx.teamMissions.get(lead).calls).toBe(3)
})

it('enforces the final tool allowlist even for a registered tool', async () => {
  const { ctx, lead } = await setup(await directory())
  let invoked = false
  ctx.tools.register(defineTool({ name: 'forbidden', description: 'Forbidden fixture', parameters: {},
    output: { schema: { type: 'array', items: { type: 'string' } }, render: () => [] },
    async execute() { invoked = true; return [] } }))
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 100, queueTimeoutMs: 1000, allowedTools: [] })
  await ctx.teamMissions.start(lead, 'Tools', 'Deny all')
  const result = await ctx.tools.execute({ agent: lead, callId: CallId('deny'), name: 'forbidden', arguments: {}, signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(invoked).toBe(false)
})

it('STOP cancels actual streaming and future calls without resetting consumption', async () => {
  const { ctx, lead } = await setup(await directory())
  const adapter = new MockAdapter(['hang'])
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 100, queueTimeoutMs: 1000, allowedTools: [] })
  await ctx.teamMissions.start(lead, 'Stop', 'No further calls')
  lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }))
  await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
  expect(adapter.requests[0]?.maxTokens).toBe(100)
  await ctx.teamMissions.transition(lead, ctx.teamMissions.get(lead).revision, 'stop')
  await lead.whenIdle()
  lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'retry' }] }))
  await lead.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ state: 'cancelled', calls: 1 })
})

it('persists STOP and consumption through a fresh storage/Team runtime', async () => {
  const path = await directory()
  const first = await setup(path)
  await first.ctx.teamMissions.start(first.lead, 'Investigate fixture', 'Evidence before success')
  expect(await first.ctx.teamMissions.reserveCall(first.lead)).toBe(1)
  await first.ctx.teamMissions.transition(first.lead, 2, 'stop')
  await first.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(first.ctx), 1)
  const second = await setup(path)
  expect(second.ctx.teamMissions.get(second.lead)).toMatchObject({ state: 'cancelled', calls: 1, revision: 3 })
  await expect(second.ctx.teamMissions.reserveCall(second.lead)).rejects.toMatchObject({ code: 'MISSION_NOT_RUNNING' })
  await expect(second.ctx.teamMissions.transition(second.lead, 3, 'resume')).rejects.toMatchObject({ code: 'MISSION_CANCELLED' })
  await expect(second.ctx.teamMissions.start(second.lead, 'reset', 'reset')).rejects.toMatchObject({ code: 'MISSION_ALREADY_EXISTS' })
})

it('reserves atomically and cannot overspend with concurrent callers', async () => {
  const { ctx, lead } = await setup(await directory())
  await ctx.teamMissions.start(lead, 'Concurrent calls', 'Two attempts maximum')
  const result = await Promise.allSettled(Array.from({ length: 6 }, () => ctx.teamMissions.reserveCall(lead)))
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(2)
  expect(ctx.teamMissions.get(lead)).toMatchObject({ calls: 2, revision: 3 })
})

it('pauses and resumes without resetting deadline, criteria or budget', async () => {
  const { ctx, lead } = await setup(await directory())
  const initial = await ctx.teamMissions.start(lead, 'Pause', 'Frozen criterion')
  await ctx.teamMissions.reserveCall(lead)
  await expect(ctx.teamMissions.transition(lead, 1, 'pause')).rejects.toMatchObject({ code: 'MISSION_STALE_REVISION' })
  await ctx.teamMissions.transition(lead, 2, 'pause')
  await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_NOT_RUNNING' })
  const resumed = await ctx.teamMissions.transition(lead, 3, 'resume')
  expect(resumed).toMatchObject({ deadline: initial.deadline, criteria: initial.criteria, calls: 1, state: 'running' })
})

it('rejects another configured owner after reopening and rejects calls after disposal', async () => {
  const path = await directory()
  const first = await setup(path)
  await first.ctx.teamMissions.start(first.lead, 'Scope', 'Same owner only')
  const service = first.ctx.teamMissions
  await first.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(first.ctx), 1)
  expect(() => service.get(first.lead)).toThrow('closed')
  const second = await setup(path, { owner: 'other' })
  expect(() => second.ctx.teamMissions.get(second.lead)).toThrow('another owner')
})

it('rejects unapproved roots, missing missions and invalid budgets', async () => {
  const { ctx, lead } = await setup(await directory())
  await expect(ctx.teamMissions.reserveCall(lead)).rejects.toMatchObject({ code: 'MISSION_NOT_FOUND' })
  const other = ctx.agentLoop.create(SessionId('wrong-workspace'), {}, { cwd: tmpdir() })
  await expect(ctx.teamMissions.start(other, 'outside', 'no')).rejects.toMatchObject({ code: 'MISSION_SCOPE_MISMATCH' })
  await expect(setup(await directory(), { maxCalls: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow()
})
