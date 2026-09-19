import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import Teams from '../src/index.ts'
import * as Missions from '../src/mission-control.ts'
import * as Execution from '../src/execution.ts'
import * as ImportLab from '../src/import-lab.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

async function setup(requirePeerReviewAfterReceipt = true) {
  const workspace = await mkdtemp(join(tmpdir(), 'leon-peer-review-'))
  directories.push(workspace)
  await writeFile(join(workspace, 'import-policy.json'), '{"mode":"upsert"}\n')
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
  await ctx.plugin(Missions, { domainName: 'peer_review', owner: 'host-test', workspace,
    maxCalls: 48, durationMs: 900000, hostComposition: true })
  await ctx.plugin(Execution, { provider: 'mock', model: 'mock', maxOutputTokens: 128,
    queueTimeoutMs: 2000, allowedTools: ['mission_task', 'mission_inspect', 'mission_verify'],
    reviewReserve: { calls: 8, reviewerRole: 'checker' } })
  await ctx.plugin(ImportLab, { workspace, requirePeerReviewAfterReceipt })
  const jobs = new Map<string, { callId: string; name: string; args: object }>()
  const script = (options: GenerateOptions) => {
    const job = options.sessionId === undefined ? undefined : jobs.get(options.sessionId)
    if (job === undefined || options.sessionId === undefined) return textResponse('idle')
    jobs.delete(options.sessionId)
    return toolCallResponse(job.callId, job.name, job.args)
  }
  const adapter = new MockAdapter(Array.from({ length: 48 }, () => script))
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = ctx.agentLoop.create(SessionId('peer-root'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
  await ctx.teamMissions.start(lead, 'Peer evidence contract', 'Use current verification after native receipt')
  const request = (name: string) => ({ name, description: name, prompt: [{ type: 'text' as const, text: 'Wait for task' }],
    context: 'fresh' as const, provider: 'spawn', signal: new AbortController().signal })
  // Labels deliberately impersonate the opposite function. Only host bindings authorize review.
  const bindings = await ctx.teamMissions.provisionTeam(lead, { researcher: request('checker'), checker: request('researcher') })
  const settle = async () => {
    for (const id of [bindings.researcher, bindings.checker]) await ctx.agents.get(id)?.whenIdle()
    await vi.waitFor(() => {
      expect(ctx.agents.get(bindings.researcher)).toBeUndefined()
      expect(ctx.agents.get(bindings.checker)).toBeUndefined()
    })
    await lead.whenIdle()
  }
  await settle()
  const events = async (id: SessionId) => ctx.agents.get(id)?.session.events
    ?? (await ctx.sessionPersistence.load(id)).events
  let calls = 0
  const runTool = async (id: SessionId, name: string, args: object = {}) => {
    const callId = `proof-${++calls}`
    jobs.set(id, { callId, name, args })
    await ctx.subagents.followup(lead, id, [{ type: 'text', text: `Run ${name}` }],
      { source: { kind: 'user' }, signal: new AbortController().signal })
    await settle()
    const results = (await events(id)).flatMap(event => event.type === 'tool/result'
      ? event.data.message.content.filter(block => block.toolCallId === callId) : [])
    expect(results).toHaveLength(1)
    const result = results[0]!
    return { isError: result.isError ?? false,
      text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') }
  }
  const peer = async () => {
    const handle = await ctx.agentLoop.resume(ctx, { resumeSessionId: bindings.researcher,
      agentOptions: { provider: 'mock', model: 'mock' } })
    try {
      await ctx.agentTeams.sendMessage(handle.agent, { target: 'researcher',
        content: [{ type: 'text', text: 'The source IDs are unique. Verify upsert preserves cardinality.' }],
        delivery: 'wakeup', signal: new AbortController().signal })
    } finally { await handle.dispose() }
    await settle()
    expect((await events(bindings.checker)).some(event => event.type === 'user/message'
      && event.data.source.kind === 'team-message')).toBe(true)
  }
  const checkerTask = () => ctx.agentTeams.listTasks(lead).find(task => task.subject === 'LC: researcher')
  return { ctx, lead, bindings, workspace, runTool, peer, events, checkerTask, adapter }
}

it('requires persistent host composition for the opt-in review contract', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  Object.defineProperty(ctx, 'teamMissions', { value: { requiresComposition: false } })
  expect(() => { ImportLab.apply(ctx, { workspace: 'unused', requirePeerReviewAfterReceipt: true }) })
    .toThrow('Peer review requires hostComposition')
})

it('rejects pre-receipt verification without mutating tasks, then accepts a current post-receipt proof', async () => {
  const { ctx, lead, bindings, workspace, runTool, peer, events, checkerTask, adapter } = await setup()
  await runTool(bindings.checker, 'mission_task', { phase: 'start' })
  expect((await runTool(bindings.checker, 'mission_verify')).isError).toBe(false)
  await peer()
  const before = checkerTask()
  const denied = await runTool(bindings.checker, 'mission_task', { phase: 'complete' })
  expect(denied.isError).toBe(true)
  expect(denied.text).toContain('MISSION_CHECKER_PEER_REVIEW_REQUIRED')
  expect(checkerTask()).toEqual(before)
  expect(checkerTask()?.status).toBe('in_progress')
  expect((await events(bindings.checker)).filter(event => event.type === 'tool/call'
    && event.data.name === 'mission_verify')).toHaveLength(1)
  const failed = JSON.parse((await ImportLab.verifyImportMission(ctx, lead, workspace)).summary) as { workerVerification: boolean }
  expect(failed.workerVerification).toBe(false)
  expect((await runTool(bindings.checker, 'mission_verify')).isError).toBe(false)
  expect((await runTool(bindings.checker, 'mission_task', { phase: 'complete' })).isError).toBe(false)
  expect(checkerTask()?.status).toBe('completed')
  // Researcher uses the original evidence rule even though its display name says checker.
  await runTool(bindings.researcher, 'mission_task', { phase: 'start' })
  await runTool(bindings.researcher, 'mission_inspect')
  expect((await runTool(bindings.researcher, 'mission_task', { phase: 'complete' })).isError).toBe(false)
  expect((await ImportLab.verifyImportMission(ctx, lead, workspace)).passed).toBe(true)
  expect(ctx.teamMissions.get(lead).maxCalls).toBe(48)
  expect(adapter.requests.length).toBeLessThanOrEqual(48)
})

it('rejects stale and failed post-receipt proofs while preserving current task revisions', async () => {
  const { bindings, workspace, runTool, peer, checkerTask } = await setup()
  await runTool(bindings.checker, 'mission_task', { phase: 'start' })
  await peer()
  await runTool(bindings.checker, 'mission_verify')
  const before = checkerTask()
  // Same semantics, different exact artifact bytes: previous digest is now stale.
  await writeFile(join(workspace, 'import-policy.json'), '{ "mode": "upsert" }\n')
  expect((await runTool(bindings.checker, 'mission_task', { phase: 'complete' })).isError).toBe(true)
  expect(checkerTask()).toEqual(before)
  await writeFile(join(workspace, 'import-policy.json'), '{"mode":"append"}\n')
  const failed = await runTool(bindings.checker, 'mission_verify')
  expect(failed.isError).toBe(false)
  expect(JSON.parse(failed.text)).toMatchObject({ passed: false })
  expect((await runTool(bindings.checker, 'mission_task', { phase: 'complete' })).text)
    .toContain('MISSION_CHECKER_PEER_REVIEW_REQUIRED')
  expect(checkerTask()).toEqual(before)
})

it('preserves v1 completion with current tool evidence but no peer receipt', async () => {
  const { bindings, runTool, checkerTask } = await setup(false)
  await runTool(bindings.checker, 'mission_task', { phase: 'start' })
  await runTool(bindings.checker, 'mission_verify')
  expect((await runTool(bindings.checker, 'mission_task', { phase: 'complete' })).isError).toBe(false)
  expect(checkerTask()?.status).toBe('completed')
})
