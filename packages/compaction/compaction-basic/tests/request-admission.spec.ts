import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installRequestAdmission } from '../src/request-admission.ts'

let ctx: Context | undefined

afterEach(async () => { await ctx?.fiber.dispose() })

class CapacityAdapter extends LlmAdapter {
  calls = 0
  constructor(private readonly contextWindow?: number, private readonly defaultMaxTokens?: number) { super() }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider, id: model, name: model,
      ...this.contextWindow === undefined ? {} : { context: { contextWindow: this.contextWindow } },
      ...this.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: this.defaultMaxTokens },
    }
  }
  override async * stream(): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(contextWindow?: number, defaultMaxTokens?: number) {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new CapacityAdapter(contextWindow, defaultMaxTokens)
  const unregister = ctx.llm.registerAdapter(['local'], adapter)
  const fiber = await ctx.plugin({ name: 'request-admission-test', inject: ['llm'], apply: installRequestAdmission })
  return { ctx, adapter, fiber, unregister }
}

function options(extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'local', model: 'worker',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } })],
    ...extra,
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('complete-request context admission', () => {
  it('accepts the exact limit and refuses one token beyond it without adapter inference', async () => {
    const { ctx, adapter } = await harness(20)
    expect(await collect(ctx.llm.stream(options({ maxTokens: 11 })))).toEqual([
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(await collect(ctx.llm.stream(options({ maxTokens: 12 })))).toEqual([
      { type: 'finish', reason: { kind: 'error', failure: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'Request refused before inference: estimated input (9 tokens) plus output reserve (12 tokens) exceeds the context capacity (20 tokens) for local/worker. Reduce the request context; history and required instructions are preserved.',
      } } },
    ])
    expect(adapter.calls).toBe(1)
  })

  it('counts system instructions and tool schemas in the effective request', async () => {
    const { ctx, adapter } = await harness(20)
    const result = await collect(ctx.llm.stream(options({
      system: 'mandatory '.repeat(20),
      tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
    })))
    expect(result).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } }])
    expect(adapter.calls).toBe(0)
  })

  it('reserves the model default output limit when callers omit it', async () => {
    const { ctx, adapter } = await harness(20, 12)
    expect(await collect(ctx.llm.stream(options()))).toMatchObject([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } },
    ])
    expect(adapter.calls).toBe(0)
  })

  it('leaves unknown capacity to the adapter without inventing a window', async () => {
    const { ctx, adapter } = await harness()
    expect(await collect(ctx.llm.stream(options({ system: 'required '.repeat(100) })))).toEqual([
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(adapter.calls).toBe(1)
  })

  it('removes admission when its owning plugin unloads', async () => {
    const { ctx, adapter, fiber } = await harness(1)
    await fiber.dispose()
    expect(await collect(ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(adapter.calls).toBe(1)
  })

  it.each([
    { originalWindow: 20, replacementWindow: 1000, denied: true },
    { originalWindow: 1000, replacementWindow: 20, denied: false },
  ])('uses the prepared adapter capacity across HMR: $originalWindow -> $replacementWindow', async ({ originalWindow, replacementWindow, denied }) => {
    const { ctx, adapter, unregister } = await harness(originalWindow)
    const prepared = await ctx.llm.prepareCall({ provider: 'local', model: 'worker', maxTokens: 12 })
    unregister()
    const replacement = new CapacityAdapter(replacementWindow)
    ctx.llm.registerAdapter(['local'], replacement)
    const chunks = await collect(prepared.stream(options(prepared.config)))
    expect(chunks).toMatchObject(denied
      ? [{ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } }]
      : [{ type: 'finish', reason: { kind: 'stop' } }])
    expect(adapter.calls).toBe(denied ? 0 : 1)
    expect(replacement.calls).toBe(0)
  })

  it('counts additions by stream middleware registered after admission', async () => {
    const { ctx, adapter } = await harness(20)
    ctx.on('llm/stream', async function* (request, next) {
      request.system = 'late required instruction '.repeat(20)
      yield* next()
    })
    expect(await collect(ctx.llm.stream(options()))).toMatchObject([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } },
    ])
    expect(adapter.calls).toBe(0)
  })

  it('confines an agent-owned admission listener to that agent, not the host or sibling', async () => {
    ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new CapacityAdapter(20, 12)
    ctx.llm.registerAdapter(['local'], adapter)
    const owner = ctx.agentLoop.create(SessionId('admission-owner'), { provider: 'local', model: 'worker' })
    const sibling = ctx.agentLoop.create(SessionId('admission-sibling'), { provider: 'local', model: 'worker' })
    await owner.ctx.plugin({ name: 'request-admission-scoped-test', inject: ['llm'], apply: installRequestAdmission })
    owner.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }))
    await owner.whenIdle()
    expect(owner.session.events.at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED' } } },
    })
    expect(adapter.calls).toBe(0)
    expect(await collect(ctx.llm.stream(options({ maxTokens: 12 })))).toEqual([
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    sibling.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }))
    await sibling.whenIdle()
    expect(sibling.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(adapter.calls).toBe(2)
  })
})
