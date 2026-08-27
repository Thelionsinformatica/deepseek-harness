import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as FailureRecovery from '@deepseek-ai/dsh-failure-recovery-policy'
import type { Config } from '@deepseek-ai/dsh-failure-recovery-policy'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const testSignal = new AbortController().signal

interface Harness {
  ctx: Context
  executions: () => number
}

/** Mount the production tool and agent pipeline with one configurable failing tool. */
async function harness(config: Config = {}, pool = new MemoryMediaPool()): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountStorage(ctx, pool)
  await ctx.plugin(FailureRecovery, config)
  let executionCount = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'failure policy probe',
    parameters: {},
    async execute(raw) {
      executionCount++
      const args = raw as { code?: string; succeed?: boolean }
      if (args.succeed === true) return [{ type: 'text' as const, text: 'ok' }]
      const code = args.code ?? 'TEST_FAILURE'
      throw new HarnessError(`probe failed with ${code}`, code)
    },
  }))
  return { ctx, executions: () => executionCount }
}

/** Mount the durable-domain form over the shared test memory backend. */
async function mountStorage(ctx: Context, pool = new MemoryMediaPool()): Promise<void> {
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const storageDomain = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
      if (current === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Recovery notices retained in one agent's reconstructed model history. */
function recoveryNotices(agent: Agent): SessionEvent<'user/message'>[] {
  return [...agent.session.events].filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'failure-recovery-policy')
}

describe('equivalent failure recovery', () => {
  it('notices after two equivalent failures and blocks the unchanged third call before dispatch', async () => {
    const { ctx, executions } = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { code: 'TEST_FAILURE' }),
      toolCallResponse('c2', 'probe', { code: 'TEST_FAILURE' }),
      toolCallResponse('c3', 'probe', { code: 'TEST_FAILURE' }),
      textResponse('changed strategy'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('blocked-third'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(2)
    const notices = recoveryNotices(agent)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.data.source).toEqual({
      kind: 'plugin',
      plugin: 'failure-recovery-policy',
      form: 'notice',
      summary: 'probe failed × 2',
    })
    const noticeContent = notices[0]!.data.content[0]
    expect(noticeContent?.type).toBe('text')
    if (noticeContent?.type !== 'text') throw new Error('expected a text recovery notice')
    expect(noticeContent.text).toContain('failure_code: TEST_FAILURE')
    const results = [...agent.session.events]
      .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(3)
    const deniedResult = results[2]!.data.message.content[0]
    expect(deniedResult.isError).toBe(true)
    const deniedContent = deniedResult.content[0]
    expect(deniedContent?.type).toBe('text')
    if (deniedContent?.type !== 'text') throw new Error('expected a text denial result')
    expect(deniedContent.text).toContain('repeated tool failure blocked')
  })

  it('allows changed arguments and then permits the original call as a fresh chain', async () => {
    const { ctx, executions } = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { code: 'A' }),
      toolCallResponse('c2', 'probe', { code: 'A' }),
      toolCallResponse('c3', 'probe', { code: 'B' }),
      toolCallResponse('c4', 'probe', { code: 'A' }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('changed-arguments'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(4)
    expect(recoveryNotices(agent)).toHaveLength(1)
  })

  it('requires equivalent failure identity before it locks one exact call', async () => {
    const { ctx, executions } = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { code: 'A' }),
      toolCallResponse('c2', 'probe', { code: 'B' }),
      toolCallResponse('c3', 'probe', { code: 'B' }),
      toolCallResponse('c4', 'probe', { code: 'B' }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('equivalent-code'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(3)
    expect(recoveryNotices(agent)).toHaveLength(1)
  })

  it('resets after a new user prompt', async () => {
    const { ctx, executions } = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      textResponse('first turn'),
      toolCallResponse('c3', 'probe', {}),
      textResponse('second turn'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('user-reset'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'try again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(3)
  })

  it('serializes concurrent equivalent failures before denying a later dispatch', async () => {
    const { ctx, executions } = await harness()
    const agent = ctx.agentLoop.create(SessionId('concurrent-failures'), { provider: 'missing', model: 'missing' })
    await Promise.all(Array.from({ length: 2 }, (_, index) => ctx.tools.execute({
      callId: CallId(`concurrent-${index}`),
      name: 'probe',
      arguments: { code: 'RACE' },
      agent,
      signal: testSignal,
    })))
    const denied = await ctx.tools.execute({
      callId: CallId('concurrent-denied'),
      name: 'probe',
      arguments: { code: 'RACE' },
      agent,
      signal: testSignal,
    })

    expect(denied.isError).toBe(true)
    expect(executions()).toBe(2)
  })

  it('restores a blocked chain in a new host for the same session id', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({}, pool)
    first.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { code: 'PERSISTED' }),
      toolCallResponse('c2', 'probe', { code: 'PERSISTED' }),
      textResponse('pause'),
    ]))
    const firstAgent = first.ctx.agentLoop.create(SessionId('resumed-chain'), { provider: 'mock', model: 'local' })
    firstAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await waitForIdle(first.ctx, firstAgent)

    const resumed = await harness({}, pool)
    const resumedAgent = resumed.ctx.agentLoop.create(
      SessionId('resumed-chain'), { provider: 'fallback', model: 'remote' },
    )
    const denied = await resumed.ctx.tools.execute({
      callId: CallId('after-resume'),
      name: 'probe',
      arguments: { code: 'PERSISTED' },
      agent: resumedAgent,
      signal: testSignal,
    })

    expect(denied.isError).toBe(true)
    expect(resumed.executions()).toBe(0)
  })
})

describe('scope and configuration', () => {
  it('keeps excluded tools and direct calls outside policy state', async () => {
    const { ctx, executions } = await harness({ exclude: ['pro*'] })
    const agent = ctx.agentLoop.create(SessionId('excluded'), { provider: 'missing', model: 'missing' })
    for (let index = 0; index < 3; index++) {
      const result = await ctx.tools.execute({
        callId: CallId(`excluded-${index}`),
        name: 'probe',
        arguments: {},
        agent,
        signal: testSignal,
      })
      expect(result.isError).toBe(true)
    }
    const direct = await ctx.tools.execute({
      callId: CallId('direct'),
      name: 'probe',
      arguments: {},
      signal: testSignal,
    })
    expect(direct.isError).toBe(true)
    expect(executions()).toBe(4)
  })

  it('removes its listeners and monotonic guard when disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountStorage(ctx)
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'probe', description: 'probe', parameters: {},
      async execute() {
        executions++
        throw new HarnessError('failed', 'TEST_FAILURE')
      },
    }))
    const fiber = await ctx.plugin(FailureRecovery, {})
    const agent = ctx.agentLoop.create(SessionId('dispose'), { provider: 'missing', model: 'missing' })
    for (let index = 0; index < 2; index++) {
      await ctx.tools.execute({
        callId: CallId(`before-${index}`), name: 'probe', arguments: {}, agent, signal: testSignal,
      })
    }
    const blocked = await ctx.tools.execute({
      callId: CallId('blocked'), name: 'probe', arguments: {}, agent, signal: testSignal,
    })
    expect(blocked.isError).toBe(true)
    expect(executions).toBe(2)
    await fiber.dispose()
    await ctx.tools.execute({
      callId: CallId('after'), name: 'probe', arguments: {}, agent, signal: testSignal,
    })
    expect(executions).toBe(3)
  })

  it('rejects invalid failure limits and supports the real Loader export path', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountStorage(ctx)
    await expect(ctx.plugin(FailureRecovery, { maxEquivalentFailures: 1 }))
      .rejects.toThrow(/integer >= 2/)
    await expect(ctx.plugin(FailureRecovery, { maxEquivalentFailures: 2.5 }))
      .rejects.toThrow(/integer >= 2/)

    expect('default' in FailureRecovery).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(FailureRecovery) as Record<string, unknown>
    expect(unwrapped).toBe(FailureRecovery)
    expect(unwrapped.name).toBe('failure-recovery-policy')
    expect(unwrapped.inject).toEqual(['tools', 'storageDomain'])
  })
})
