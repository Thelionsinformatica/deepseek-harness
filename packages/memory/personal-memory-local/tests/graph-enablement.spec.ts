import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import PersonalMemoryRuntime, { PersonalMemoryOwnerId } from '@deepseek-ai/dsh-personal-memory'
import * as PersonalMemoryLocal from '@deepseek-ai/dsh-personal-memory-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const owner = { ownerId: PersonalMemoryOwnerId('owner-alpha') }
const other = { ownerId: PersonalMemoryOwnerId('owner-beta') }
const workspace = { workspaceId: WorkspaceId('workspace-alpha') }
const source = { kind: 'session' as const, sessionId: SessionId('synthetic-graph-test') }
const contexts: Context[] = []
const config = {
  embeddings: {
    baseUrl: 'http://127.0.0.1:8099', api: 'openai-compatible',
    model: 'personal-model', dimensions: 64, timeoutMs: 2_000,
  },
  linking: { enabled: true, minScore: 0.75, debounceMs: 10 },
} satisfies PersonalMemoryLocal.Config

async function context(pool = new MemoryMediaPool(), enabled = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PersonalMemoryRuntime, { provider: 'local', enabled })
  return { ctx, pool, facility }
}

function embeddingResponse(inputCount: number) {
  return new Response(JSON.stringify({
    data: Array.from({ length: inputCount }, (_, index) => ({
      index, embedding: Array.from({ length: 64 }, (_value, axis) => axis === 0 ? 1 : 0),
    })),
  }), { status: 200 })
}

function parseRequest(init?: RequestInit): { model: string; input: string[] } {
  if (typeof init?.body !== 'string') throw new Error('expected serialized embedding input')
  return JSON.parse(init.body) as { model: string; input: string[] }
}

async function pause(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 35))
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('personal graph follows the host opt-in state', () => {
  it('boots disabled with existing records without embedding, then builds after opt-in', async () => {
    const pool = new MemoryMediaPool()
    const seeded = await context(pool)
    await seeded.ctx.plugin(PersonalMemoryLocal, {})
    const first = await seeded.ctx.personalMemory.create({ scope: owner, content: 'alpha preference one', source })
    const second = await seeded.ctx.personalMemory.create({ scope: owner, content: 'alpha preference two', source })
    await seeded.ctx.fiber.dispose()

    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => embeddingResponse(parseRequest(init).input.length))
    vi.stubGlobal('fetch', fetchSpy)
    const restarted = await context(pool, false)
    await restarted.ctx.plugin(PersonalMemoryLocal, config)
    await pause()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await restarted.ctx.personalMemory.list({ scope: owner, limit: 10 })).items).toHaveLength(2)
    expect((await restarted.ctx.personalMemory.graph({ scope: owner })).status).toBe('unavailable')

    restarted.ctx.personalMemory.setEnabled(true)
    await vi.waitFor(async () => {
      expect((await restarted.ctx.personalMemory.graph({ scope: owner })).status).toBe('computed')
    })
    const graph = await restarted.ctx.personalMemory.graph({ scope: owner })
    expect(graph.recordRevisions).toEqual({ [first.id]: 1, [second.id]: 1 })
    expect(graph.edges).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('aborts a personal rebuild, keeps workspace work enabled, then rebuilds owner scopes independently', async () => {
    let holdPersonal = false
    let aborted = false
    const requests: { model: string; input: string[] }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = parseRequest(init)
      requests.push(request)
      if (holdPersonal && request.model === 'personal-model') {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => { aborted = true; reject(new DOMException('cancelled', 'AbortError')) }
          if (init?.signal?.aborted === true) abort()
          else init?.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      return embeddingResponse(request.input.length)
    }))
    const { ctx } = await context()
    const graphEvents: { workspaceId: WorkspaceId; generation: number }[] = []
    ctx.on('memory/graph', (event) => { graphEvents.push(event) })
    await ctx.plugin(PersonalMemoryLocal, config)
    await ctx.plugin(MemoryRuntime, { provider: 'local' })
    await ctx.plugin(MemoryLocal, {
      semanticSearch: { ...config.embeddings, enabled: true, model: 'workspace-model' },
      linking: config.linking,
    })
    const alphaOne = await ctx.personalMemory.create({ scope: owner, content: 'alpha preference one', source })
    const alphaTwo = await ctx.personalMemory.create({ scope: owner, content: 'alpha preference two', source })
    const betaOne = await ctx.personalMemory.create({ scope: other, content: 'beta preference one', source })
    const betaTwo = await ctx.personalMemory.create({ scope: other, content: 'beta preference two', source })
    await vi.waitFor(async () => {
      expect((await ctx.personalMemory.graph({ scope: owner })).status).toBe('computed')
      expect((await ctx.personalMemory.graph({ scope: other })).status).toBe('computed')
    })
    const before = requests.length
    holdPersonal = true
    await ctx.personalMemory.update({ scope: owner, ref: { id: alphaOne.id, revision: 1 }, content: 'alpha updated preference' })
    await vi.waitFor(() => { expect(requests).toHaveLength(before + 1) })
    const eventsBeforeStop = graphEvents.length
    ctx.personalMemory.setEnabled(false)
    await vi.waitFor(() => { expect(aborted).toBe(true) })
    expect(ctx.personalMemory.isEnabled()).toBe(false)
    expect((await ctx.personalMemory.graph({ scope: owner })).status).toBe('unavailable')
    await pause()
    expect(graphEvents).toHaveLength(eventsBeforeStop)
    expect(requests).toHaveLength(before + 1)
    await expect(ctx.personalMemory.create({ scope: owner, content: 'blocked mutation', source }))
      .rejects.toMatchObject({ code: 'PERSONAL_MEMORY_DISABLED' })

    await ctx.memory.create({ scope: workspace, content: 'workspace fact one', source })
    await ctx.memory.create({ scope: workspace, content: 'workspace fact two', source })
    await vi.waitFor(async () => { expect((await ctx.memory.graph({ scope: workspace })).status).toBe('computed') })
    expect(requests.some(request => request.model === 'workspace-model')).toBe(true)
    expect(requests.filter(request => request.model === 'personal-model')).toHaveLength(before + 1)

    holdPersonal = false
    ctx.personalMemory.setEnabled(true)
    await vi.waitFor(async () => {
      expect((await ctx.personalMemory.graph({ scope: owner })).status).toBe('computed')
      expect((await ctx.personalMemory.graph({ scope: other })).status).toBe('computed')
    })
    const alphaGraph = await ctx.personalMemory.graph({ scope: owner })
    const betaGraph = await ctx.personalMemory.graph({ scope: other })
    expect(alphaGraph.recordRevisions).toEqual({ [alphaOne.id]: 2, [alphaTwo.id]: 1 })
    expect(betaGraph.recordRevisions).toEqual({ [betaOne.id]: 1, [betaTwo.id]: 1 })
    for (const request of requests) {
      const content = request.input.join(' ')
      expect(content.includes('alpha') && content.includes('beta')).toBe(false)
      if (request.model === 'personal-model') expect(content).not.toContain('workspace fact')
      else expect(content).not.toContain('preference')
    }
  })

  it('forgets while disabled and reactivation reconciles the empty persisted graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => embeddingResponse(parseRequest(init).input.length)))
    const { ctx } = await context()
    await ctx.plugin(PersonalMemoryLocal, config)
    const first = await ctx.personalMemory.create({ scope: owner, content: 'first preference', source })
    const second = await ctx.personalMemory.create({ scope: owner, content: 'second preference', source })
    await vi.waitFor(async () => { expect((await ctx.personalMemory.graph({ scope: owner })).status).toBe('computed') })
    const calls = vi.mocked(fetch).mock.calls.length
    ctx.personalMemory.setEnabled(false)
    await ctx.personalMemory.forget({ scope: owner, ref: { id: first.id, revision: 1 } })
    await ctx.personalMemory.forget({ scope: owner, ref: { id: second.id, revision: 1 } })
    await pause()
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls)
    ctx.personalMemory.setEnabled(true)
    await vi.waitFor(async () => {
      expect((await ctx.personalMemory.graph({ scope: owner })).status).toBe('empty')
    })
    expect((await ctx.personalMemory.graph({ scope: owner })).recordRevisions).toEqual({})
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls)
  })
})

describe('personal graph validates before opening storage', () => {
  it.each([
    { linking: { enabled: true, minScore: 2 } },
    { linking: { enabled: true, maxEdgesPerNode: 0 } },
    { linking: { enabled: true, maxGraphNodes: 0 } },
    { linking: { enabled: true, maxExpandedHits: -1 } },
    { linking: { enabled: true, debounceMs: -1 } },
    { embeddings: { baseUrl: 'https://example.com' } },
    { embeddings: { dimensions: 0 } },
    { embeddings: { timeoutMs: 0 } },
  ] satisfies PersonalMemoryLocal.Config[])('rejects %j without materializing a domain', async (invalid) => {
    const { ctx, pool, facility } = await context()
    const open = vi.spyOn(facility, 'open')
    // Direct application preserves the rejected initialization Promise while using real dependencies.
    await expect(PersonalMemoryLocal.apply(ctx, invalid)).rejects.toThrow('memory-local:')
    expect(open).not.toHaveBeenCalled()
    expect(pool.media.size).toBe(0)
    await ctx.plugin(PersonalMemoryLocal, config)
    expect(pool.media.has('personal_memory_local')).toBe(true)
  })
})
