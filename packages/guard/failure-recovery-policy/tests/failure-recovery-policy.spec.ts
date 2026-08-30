import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage, HarnessError, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as FailureRecovery from '@deepseek-ai/dsh-failure-recovery-policy'
import { NO_FINAL_RESPONSE_CODE, type Config } from '@deepseek-ai/dsh-failure-recovery-policy'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const testSignal = new AbortController().signal

/** Script one response containing internal reasoning but no final text or tool call. */
function reasoningResponse(text: string, finish: 'stop' | 'tool-calls' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: finish } },
  ]
}

/** Script an extension-defined completion reason to exercise the merge-extensible finish contract. */
function futureCompletionResponse(text: string): StreamChunk[] {
  const response = reasoningResponse(text)
  response[response.length - 1] = {
    type: 'finish',
    reason: { kind: 'provider-complete' },
  } as unknown as StreamChunk
  return response
}

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
  ctx.tools.register(defineContentToolFixture({
    name: 'conclude',
    description: 'conclude the current turn',
    parameters: {},
    async execute(_raw, exec) {
      exec.concludeTurn()
      return [{ type: 'text' as const, text: 'concluded' }]
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

/** Final-response recovery messages durably committed in one agent's history. */
function finalResponseNotices(agent: Agent): SessionEvent<'user/message'>[] {
  return recoveryNotices(agent).filter(event => event.data.source.kind === 'plugin'
    && event.data.source.form === 'notice'
    && event.data.source.summary?.startsWith('Final response recovery '))
}

describe('terminal response recovery', () => {
  it('steers one durable instruction after reasoning-only output and then accepts final text', async () => {
    const { ctx } = await harness({ maxNoFinalResponseRecoveries: 1 })
    const adapter = new MockAdapter([
      reasoningResponse('I should inspect the workspace.'),
      textResponse('verified final answer'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-recovery'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'inspect' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    const notices = finalResponseNotices(agent)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.data.source).toEqual({
      kind: 'plugin',
      plugin: 'failure-recovery-policy',
      form: 'notice',
      summary: 'Final response recovery 1/1',
    })
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('Do not repeat or restate the plan.')
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('ends with NO_FINAL_RESPONSE after the durable same-turn limit is exhausted', async () => {
    const { ctx } = await harness({ maxNoFinalResponseRecoveries: 1 })
    const adapter = new MockAdapter([
      reasoningResponse('first plan'),
      reasoningResponse('second plan'),
      textResponse('must not run'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-limit'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    expect([...agent.session.events].filter(event => event.type === 'step/start')).toHaveLength(2)
    expect(finalResponseNotices(agent)).toHaveLength(1)
    expect([...agent.session.events].findLast(event => event.type === 'assistant/chunk')).toMatchObject({
      data: {
        chunk: {
          type: 'finish',
          reason: { kind: 'error', failure: { code: NO_FINAL_RESPONSE_CODE } },
        },
      },
    })
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: {
        reason: {
          kind: 'error',
          error: {
            code: NO_FINAL_RESPONSE_CODE,
            message: 'model stopped without a final answer or tool call after 1 recovery attempt',
          },
        },
      },
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fresh task' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(3)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('treats whitespace-only text as incomplete and honors a configured recovery limit', async () => {
    const { ctx } = await harness({ maxNoFinalResponseRecoveries: 2 })
    const adapter = new MockAdapter([
      textResponse(' \n\t\u200B\u200D\u2060'),
      reasoningResponse('still planning'),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('blank-recovery'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(3)
    expect(finalResponseNotices(agent).map(event => event.data.source)).toEqual([
      {
        kind: 'plugin', plugin: 'failure-recovery-policy',
        form: 'notice', summary: 'Final response recovery 1/2',
      },
      {
        kind: 'plugin', plugin: 'failure-recovery-policy',
        form: 'notice', summary: 'Final response recovery 2/2',
      },
    ])
  })

  it('does not recover max-token reasoning output', async () => {
    const { ctx } = await harness()
    const adapter = new MockAdapter([reasoningResponse('unfinished', 'max-tokens')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-max-tokens'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect([...agent.session.events].filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(finalResponseNotices(agent)).toHaveLength(0)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'max-tokens' } },
    })
  })

  it('guards an extension-defined completion reason when it has no terminal output', async () => {
    const { ctx } = await harness()
    const adapter = new MockAdapter([futureCompletionResponse('provider-specific plan')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-future-finish'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect([...agent.session.events].findLast(event => event.type === 'assistant/chunk')).toMatchObject({
      data: {
        chunk: {
          type: 'finish',
          reason: { kind: 'error', failure: { code: NO_FINAL_RESPONSE_CODE } },
        },
      },
    })
  })

  it('defaults to zero recoveries and fails visibly on the first occurrence', async () => {
    const { ctx } = await harness()
    const adapter = new MockAdapter([
      reasoningResponse('plan once', 'tool-calls'),
      textResponse('fresh turn succeeds'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-zero-limit'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect([...agent.session.events].filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(finalResponseNotices(agent)).toHaveLength(0)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: {
        reason: {
          kind: 'error',
          error: {
            code: NO_FINAL_RESPONSE_CODE,
            message: 'model stopped without a final answer or tool call after 0 recovery attempts',
          },
        },
      },
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'new request' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(2)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('accepts non-blank text and a concluding tool call without steering', async () => {
    const textHarness = await harness()
    const textAdapter = new MockAdapter([textResponse('\u200Bfinal\u2060')])
    textHarness.ctx.llm.registerAdapter(['mock'], textAdapter)
    const textAgent = textHarness.ctx.agentLoop.create(
      SessionId('terminal-text'), { provider: 'mock', model: 'mock' },
    )
    textAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'answer' }], source: { kind: 'user' } }))
    await waitForIdle(textHarness.ctx, textAgent)

    const toolHarness = await harness()
    const toolAdapter = new MockAdapter([toolCallResponse('done', 'conclude', {})])
    toolHarness.ctx.llm.registerAdapter(['mock'], toolAdapter)
    const toolAgent = toolHarness.ctx.agentLoop.create(
      SessionId('terminal-tool'), { provider: 'mock', model: 'mock' },
    )
    toolAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'act' }], source: { kind: 'user' } }))
    await waitForIdle(toolHarness.ctx, toolAgent)

    expect(textAdapter.requests).toHaveLength(1)
    expect(toolAdapter.requests).toHaveLength(1)
    expect(finalResponseNotices(textAgent)).toHaveLength(0)
    expect(finalResponseNotices(toolAgent)).toHaveLength(0)
  })

  it('allows at most three durable recoveries before a synthetic stream failure', async () => {
    const { ctx } = await harness({ maxNoFinalResponseRecoveries: 3 })
    const adapter = new MockAdapter([
      reasoningResponse('plan 1'),
      reasoningResponse('plan 2'),
      reasoningResponse('plan 3'),
      reasoningResponse('plan 4'),
      textResponse('must not reach the provider'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('reasoning-safe-cap'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(4)
    expect(finalResponseNotices(agent)).toHaveLength(3)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: {
        reason: {
          kind: 'error',
          error: {
            code: NO_FINAL_RESPONSE_CODE,
            message: 'model stopped without a final answer or tool call after 3 recovery attempts',
          },
        },
      },
    })
  })

  it('lets turn-stopping listeners registered on both sides run around recovery steering', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountStorage(ctx)
    const observed: string[] = []
    ctx.on('agent/turn-stopping', () => { observed.push('before') })
    await ctx.plugin(FailureRecovery, { maxNoFinalResponseRecoveries: 1 })
    ctx.on('agent/turn-stopping', () => { observed.push('after') })
    const adapter = new MockAdapter([reasoningResponse('plan only'), textResponse('final after steering')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('listener-coexistence'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(observed).toEqual(['before', 'after', 'before', 'after'])
    expect(adapter.requests).toHaveLength(2)
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('runs llm/stream listeners on both sides and commits the transformed error finish', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountStorage(ctx)
    const observed: string[] = []
    const beforeFinishes: string[] = []
    const afterFinishes: string[] = []
    ctx.on('llm/stream', (_options, next) => {
      observed.push('before')
      return (async function* () {
        for await (const chunk of next()) {
          if (chunk.type === 'finish') beforeFinishes.push(chunk.reason.kind)
          yield chunk
        }
      })()
    })
    await ctx.plugin(FailureRecovery, { maxNoFinalResponseRecoveries: 0 })
    ctx.on('llm/stream', (_options, next) => {
      observed.push('after')
      return (async function* () {
        for await (const chunk of next()) {
          if (chunk.type === 'finish') afterFinishes.push(chunk.reason.kind)
          yield chunk
        }
      })()
    })
    const adapter = new MockAdapter([reasoningResponse('plan only'), textResponse('must not run')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('stream-listener-coexistence'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'execute' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(observed).toEqual(['before', 'after'])
    expect(beforeFinishes).toEqual(['error'])
    expect(afterFinishes).toEqual(['stop'])
    expect(adapter.requests).toHaveLength(1)
    expect([...agent.session.events].findLast(event => event.type === 'assistant/chunk')).toMatchObject({
      data: {
        chunk: {
          type: 'finish',
          reason: { kind: 'error', failure: { code: NO_FINAL_RESPONSE_CODE } },
        },
      },
    })
    expect([...agent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { code: NO_FINAL_RESPONSE_CODE } } },
    })
  })
})

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

    const adapter = new MockAdapter([reasoningResponse('allowed after disposal')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const turnAgent = ctx.agentLoop.create(SessionId('disposed-turn-listener'), { provider: 'mock', model: 'mock' })
    turnAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, turnAgent)
    expect(adapter.requests).toHaveLength(1)
    expect(finalResponseNotices(turnAgent)).toHaveLength(0)
    expect([...turnAgent.session.events].findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
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
    await expect(ctx.plugin(FailureRecovery, { maxNoFinalResponseRecoveries: -1 }))
      .rejects.toThrow(/maxNoFinalResponseRecoveries -1.*integer between 0 and 3/)
    await expect(ctx.plugin(FailureRecovery, { maxNoFinalResponseRecoveries: 1.5 }))
      .rejects.toThrow(/maxNoFinalResponseRecoveries 1.5.*integer between 0 and 3/)
    await expect(ctx.plugin(FailureRecovery, { maxNoFinalResponseRecoveries: 4 }))
      .rejects.toThrow(/maxNoFinalResponseRecoveries 4.*integer between 0 and 3/)

    expect('default' in FailureRecovery).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(FailureRecovery) as Record<string, unknown>
    expect(unwrapped).toBe(FailureRecovery)
    expect(unwrapped.name).toBe('failure-recovery-policy')
    expect(unwrapped.inject).toEqual(['tools', 'storageDomain'])
  })
})
