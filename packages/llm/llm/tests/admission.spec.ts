import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '../src/index.ts'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '../src/index.ts'
import { createScope } from '@deepseek-ai/dsh-scope'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose() })

async function harness() {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  class Adapter extends LlmAdapter {
    calls = 0
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return { provider, id: model, name: model, context: { contextWindow: 20 }, defaultMaxTokens: 5 }
    }
    override async * stream(): AsyncIterable<StreamChunk> {
      this.calls += 1
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  return { ctx, adapter }
}

async function consume(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const options = (): GenerateOptions => ({ provider: 'fixture', model: 'worker', messages: [] })

it('admits frozen effective options and the exact model before invoking the adapter', async () => {
  const { ctx, adapter } = await harness()
  let observed = false
  ctx.on('llm/admission', (request, model) => {
    observed = true
    expect(adapter.calls).toBe(0)
    expect(request.maxTokens).toBe(5)
    expect(model.context?.contextWindow).toBe(20)
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.messages)).toBe(true)
    expect(Object.isFrozen(model.context)).toBe(true)
  })
  expect(await consume(ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(observed).toBe(true)
  expect(adapter.calls).toBe(1)
})

it('returns the first explicit refusal without calling later listeners or the adapter', async () => {
  const { ctx, adapter } = await harness()
  const failure = { code: 'FIXTURE_DENIED', message: 'Fixture request refused.' }
  ctx.on('llm/admission', () => failure)
  ctx.on('llm/admission', () => { throw new Error('must not run after refusal') })
  expect(await consume(ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'error', failure } }])
  expect(adapter.calls).toBe(0)
})

it('keeps admission-listener errors outside adapter failure normalization', async () => {
  const { ctx, adapter } = await harness()
  ctx.on('llm/admission', () => { throw new Error('fixture listener failed') })
  await expect(consume(ctx.llm.stream(options()))).rejects.toThrow('fixture listener failed')
  expect(adapter.calls).toBe(0)
})

it('does not invoke admission when stream middleware supplies the entire response', async () => {
  const { ctx, adapter } = await harness()
  ctx.on('llm/stream', async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
  ctx.on('llm/admission', () => { throw new Error('no adapter dispatch to admit') })
  expect(await consume(ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(adapter.calls).toBe(0)
})

it('inherits preset admission down the scope chain without affecting the host or siblings', async () => {
  const { ctx, adapter } = await harness()
  const presetKey = {}
  const owner = await ctx.plugin({ name: 'admission-scope-owner', inject: ['llm'], apply() {} })
  const preset = createScope(owner.ctx, presetKey)
  const child = createScope(owner.ctx, {}, { parent: presetKey })
  const sibling = createScope(owner.ctx, {})
  const failure = { code: 'SCOPED_DENIAL', message: 'The preset refuses this request.' }
  preset.ctx.on('llm/admission', () => failure)
  const refused = [{ type: 'finish', reason: { kind: 'error', failure } }]
  expect(await consume(preset.ctx.llm.stream(options()))).toEqual(refused)
  const prepared = await child.ctx.llm.prepareCall(options())
  expect(await consume(prepared.stream({ ...options(), ...prepared.config }))).toEqual(refused)
  expect(await consume(ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(await consume(sibling.ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(adapter.calls).toBe(2)
  await preset.dispose()
  expect(await consume(child.ctx.llm.stream(options()))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(adapter.calls).toBe(3)
})
