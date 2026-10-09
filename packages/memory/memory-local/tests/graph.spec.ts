import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime, { MemoryId } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import {
  MemoryGraphScheduler,
  type MemoryGraphConfig,
  type MemoryGraphEvent,
} from '../src/graph.ts'
import { OllamaSemanticIndex } from '../src/semantic.ts'
import type { LocalMemoryGraph, LocalMemoryRecord } from '../src/spec.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const alpha = WorkspaceId('workspace-alpha')
const beta = WorkspaceId('workspace-beta')
const scope = { workspaceId: alpha }
const source = { kind: 'session' as const, sessionId: SessionId('session-alpha') }

function record(workspaceId: WorkspaceId, content: string, revision = 1): LocalMemoryRecord {
  return {
    workspaceId,
    content,
    revision,
    source,
    schemaVersion: 2,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  }
}

/** Map-backed KvTable stub exposing only the surface the scheduler uses. */
function table<K extends string, V>(initial: Iterable<readonly [K, V]> = []): KvTable<K, V> {
  const records = new Map<K, V>(initial)
  return {
    get: (key: K) => records.get(key),
    entries: () => records.entries(),
    put: async (key: K, value: V) => { records.set(key, value) },
    mutate: async <R>(key: K, decide: (current: V | undefined) =>
      { kind: 'keep'; result: R } | { kind: 'put'; value: V; result: R }) => {
      const decision = decide(records.get(key))
      if (decision.kind === 'put') records.set(key, decision.value)
      return decision.result
    },
    delete: async (key: K) => records.delete(key),
  } as KvTable<K, V>
}

function graphConfig(overrides: Partial<MemoryGraphConfig> = {}): MemoryGraphConfig {
  return {
    enabled: true,
    minScore: 0.9,
    maxEdgesPerNode: 5,
    maxGraphNodes: 50,
    debounceMs: 0,
    model: 'nomic-embed-text',
    api: 'ollama',
    ...overrides,
  }
}

/** Deterministic embedding endpoint keyed on the embedded document text; fixtures carry 4 effective axes padded to 64. */
function stubEmbeddings(vectors: Record<string, readonly number[]>, dimensions = 64): void {
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new TypeError('expected a serialized request body')
    const body = JSON.parse(init.body) as { input: string[] }
    return new Response(JSON.stringify({
      embeddings: body.input.map((input) => {
        const content = input.replace(/^search_(query|document): /, '')
        const vector = vectors[content]
        if (vector === undefined) throw new TypeError(`unstubbed embedding input: ${input}`)
        return Array.from({ length: dimensions }, (_value, index) => vector[index] ?? 0)
      }),
    }), { status: 200 })
  }))
}

function schedulerHarness(
  memories: KvTable<MemoryId, LocalMemoryRecord>,
  config = graphConfig(),
  events: Omit<MemoryGraphEvent, 'schemaVersion'>[] = [],
) {
  const graphTable = table<WorkspaceId, LocalMemoryGraph>()
  const scheduler = new MemoryGraphScheduler(
    graphTable,
    memories,
    new OllamaSemanticIndex({
      baseUrl: 'http://127.0.0.1:8099',
      model: 'nomic-embed-text',
      dimensions: 64,
      timeoutMs: 5_000,
      maxCacheEntries: 64,
      maxResponseBytes: 1_000_000,
    }),
    config,
    (event) => { events.push(event) },
  )
  return { graphTable, scheduler, events }
}

async function settled(): Promise<void> {
  await vi.waitFor(() => {}, { timeout: 2_000, interval: 5 })
  await new Promise(resolve => setTimeout(resolve, 20))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('memory similarity graph scheduler', () => {
  it('reports empty without scheduling work for an unused partition', async () => {
    const memories = table<MemoryId, LocalMemoryRecord>()
    const { scheduler, graphTable } = schedulerHarness(memories)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(scheduler.snapshot(alpha)).toEqual({ row: undefined, status: 'empty' })
    await settled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(graphTable.get(alpha)).toBeUndefined()
    await scheduler.dispose()
  })

  it('publishes one atomic snapshot with revision-pinned edges after a commit', async () => {
    stubEmbeddings({ 'fato a': [1, 0, 0, 0], 'fato b': [1, 0, 0, 0] })
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)

    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graphTable.get(alpha)).toBeDefined() })

    const snapshot = graphTable.get(alpha)!
    expect(snapshot.status).toBe('computed')
    expect(snapshot.edges).toHaveLength(1)
    expect(snapshot.edges[0]).toMatchObject({
      a: { id: MemoryId('mem-a'), revision: 1 },
      b: { id: MemoryId('mem-b'), revision: 1 },
      kind: 'semantic',
    })
    expect(snapshot.recordRevisions).toEqual({ 'mem-a': 1, 'mem-b': 1 })
    expect(scheduler.snapshot(alpha).status).toBe('computed')
    await scheduler.dispose()
  })

  it('distinguishes computed-empty from pending when no pair reaches the threshold', async () => {
    stubEmbeddings({ 'fato a': [1, 0, 0, 0], 'fato b': [0, 1, 0, 0] })
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)

    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graphTable.get(alpha)).toBeDefined() })

    const snapshot = graphTable.get(alpha)!
    expect(snapshot.status).toBe('empty')
    expect(snapshot.edges).toEqual([])
    expect(scheduler.snapshot(alpha).status).toBe('empty')
    await scheduler.dispose()
  })

  it('marks a published snapshot stale after correction and recomputes against new revisions', async () => {
    stubEmbeddings({
      'fato a': [1, 0, 0, 0],
      'fato a corrigido': [1, 0, 0, 0],
      'fato b': [1, 0, 0, 0],
    })
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graphTable.get(alpha)).toBeDefined() })

    await memories.put(MemoryId('mem-a'), record(alpha, 'fato a corrigido', 2))
    scheduler.dirty(alpha)
    expect(scheduler.snapshot(alpha).status).toBe('stale')

    await vi.waitFor(() => {
      expect(graphTable.get(alpha)?.recordRevisions).toEqual({ 'mem-a': 2, 'mem-b': 1 })
    })
    expect(scheduler.snapshot(alpha).status).toBe('computed')
    expect(graphTable.get(alpha)?.edges[0]?.a).toEqual({ id: MemoryId('mem-a'), revision: 2 })
    await scheduler.dispose()
  })

  it('drops edges of a forgotten record instead of reintroducing it', async () => {
    stubEmbeddings({ 'fato a': [1, 0, 0, 0], 'fato b': [1, 0, 0, 0] })
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graphTable.get(alpha)?.edges).toHaveLength(1) })

    await memories.delete(MemoryId('mem-b'))
    scheduler.dirty(alpha)
    await vi.waitFor(() => {
      expect(graphTable.get(alpha)?.recordRevisions).toEqual({ 'mem-a': 1 })
    })
    const snapshot = graphTable.get(alpha)!
    expect(snapshot.status).toBe('empty')
    expect(snapshot.edges).toEqual([])
    await scheduler.dispose()
  })

  it('discards an obsolete computation whose generation a newer commit superseded', async () => {
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) await gate
      const unit = Array.from({ length: 64 }, (_v, i) => i === 0 ? 1 : 0)
      return new Response(JSON.stringify({ embeddings: [unit, unit] }), { status: 200 })
    }))
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)

    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(calls).toBe(1) })
    scheduler.dirty(alpha)
    releaseFirst!()
    await vi.waitFor(() => { expect(graphTable.get(alpha)).toBeDefined() })

    const snapshot = graphTable.get(alpha)!
    expect(snapshot.generation).toBe(2)
    await scheduler.dispose()
  })

  it('records a failed snapshot once instead of retrying on every read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const fetchSpy = vi.mocked(fetch)
    const { scheduler, graphTable } = schedulerHarness(memories)

    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graphTable.get(alpha)?.status).toBe('failed') })
    const callsAfterFailure = fetchSpy.mock.calls.length
    expect(scheduler.snapshot(alpha).status).toBe('failed')
    expect(scheduler.snapshot(alpha).status).toBe('failed')
    await settled()
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFailure)
    await scheduler.dispose()
  })

  it('keeps workspace partitions disjoint when seeding existing records', async () => {
    stubEmbeddings({
      'fato alpha um': [1, 0, 0, 0],
      'fato alpha dois': [1, 0, 0, 0],
      'fato beta': [0, 1, 0, 0],
    })
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a1'), record(alpha, 'fato alpha um')],
      [MemoryId('mem-a2'), record(alpha, 'fato alpha dois')],
      [MemoryId('mem-b1'), record(beta, 'fato beta')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories)

    scheduler.seedExisting()
    await vi.waitFor(() => {
      expect(graphTable.get(alpha)).toBeDefined()
      expect(graphTable.get(beta)).toBeDefined()
    })

    const alphaSnapshot = graphTable.get(alpha)!
    expect(alphaSnapshot.status).toBe('computed')
    expect(alphaSnapshot.edges).toHaveLength(1)
    expect(JSON.stringify(alphaSnapshot.edges)).not.toContain('mem-b1')
    expect(graphTable.get(beta)!.status).toBe('empty')
    await scheduler.dispose()
  })

  it('cancels debounced work on dispose without publishing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const memories = table<MemoryId, LocalMemoryRecord>([
      [MemoryId('mem-a'), record(alpha, 'fato a')],
      [MemoryId('mem-b'), record(alpha, 'fato b')],
    ])
    const { scheduler, graphTable } = schedulerHarness(memories, graphConfig({ debounceMs: 60_000 }))
    scheduler.dirty(alpha)
    await scheduler.dispose()
    await settled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(graphTable.get(alpha)).toBeUndefined()
  })
})

describe('provider graph surface through the real composition', () => {
  async function harness(config: MemoryLocal.Config, pool = new MemoryMediaPool()) {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(MemoryRuntime, { provider: 'local' })
    await ctx.plugin(MemoryLocal, config)
    return { ctx, pool }
  }

  const enabled: MemoryLocal.Config = {
    semanticSearch: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8099',
      model: 'nomic-embed-text',
      dimensions: 64,
    },
    linking: { enabled: true, debounceMs: 0, minScore: 0.9 },
  }

  it('returns unavailable when linking is not configured', async () => {
    const { ctx } = await harness({})
    try {
      await expect(ctx.memory.graph({ scope })).resolves.toMatchObject({
        status: 'unavailable',
        edges: [],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('exposes pending, then a published snapshot after commits, without read-triggered work', async () => {
    stubEmbeddings({ 'fato a': [1, 0, 0, 0], 'fato b': [1, 0, 0, 0] })
    const { ctx } = await harness(enabled)
    try {
      await ctx.memory.create({ scope, content: 'fato a', source })
      await ctx.memory.create({ scope, content: 'fato b', source })
      const before = await ctx.memory.graph({ scope })
      expect(before.status === 'pending' || before.status === 'computed').toBe(true)

      await vi.waitFor(async () => {
        expect((await ctx.memory.graph({ scope })).status).toBe('computed')
      })
      const snapshot = await ctx.memory.graph({ scope })
      expect(snapshot.edges).toHaveLength(1)
      expect(snapshot.edges[0]?.kind).toBe('semantic')
      expect(Object.keys(snapshot.recordRevisions)).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('expands search recall through published edges when the embedding endpoint is down', async () => {
    stubEmbeddings({
      oauth: [1, 0, 0, 0],
      'Configuração oauth pendente.': [1, 0, 0, 0],
      'XYZZY nota sobre gatos.': [1, 0, 0, 0],
    })
    const { ctx } = await harness(enabled)
    try {
      await ctx.memory.create({ scope, content: 'Configuração oauth pendente.', source })
      const neighbor = await ctx.memory.create({ scope, content: 'XYZZY nota sobre gatos.', source })
      await vi.waitFor(async () => {
        expect((await ctx.memory.graph({ scope })).status).toBe('computed')
      })

      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
      const hits = await ctx.memory.search({ scope, query: 'oauth', limit: 10 })
      expect(hits.map(hit => String(hit.record.id))).toContain(String(neighbor.id))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not surface the same neighbor when linking is disabled', async () => {
    stubEmbeddings({
      oauth: [1, 0, 0, 0],
      'Configuração oauth pendente.': [1, 0, 0, 0],
      'XYZZY nota sobre gatos.': [1, 0, 0, 0],
    })
    const { ctx } = await harness(
      enabled.semanticSearch === undefined ? {} : { semanticSearch: enabled.semanticSearch },
    )
    try {
      await ctx.memory.create({ scope, content: 'Configuração oauth pendente.', source })
      const neighbor = await ctx.memory.create({ scope, content: 'XYZZY nota sobre gatos.', source })
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
      const hits = await ctx.memory.search({ scope, query: 'oauth', limit: 10 })
      expect(hits.map(hit => String(hit.record.id))).not.toContain(String(neighbor.id))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('skips expansion while the snapshot is stale after a correction', async () => {
    stubEmbeddings({
      oauth: [1, 0, 0, 0],
      'Configuração oauth pendente.': [1, 0, 0, 0],
      'Configuração oauth confirmada.': [1, 0, 0, 0],
      'XYZZY nota sobre gatos.': [1, 0, 0, 0],
    })
    const { ctx } = await harness(enabled)
    try {
      const created = await ctx.memory.create({ scope, content: 'Configuração oauth pendente.', source })
      const neighbor = await ctx.memory.create({ scope, content: 'XYZZY nota sobre gatos.', source })
      await vi.waitFor(async () => {
        expect((await ctx.memory.graph({ scope })).status).toBe('computed')
      })
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
      await ctx.memory.update({
        scope,
        ref: { id: created.id, revision: 1 },
        content: 'Configuração oauth confirmada.',
      })
      const hits = await ctx.memory.search({ scope, query: 'oauth', limit: 10 })
      expect(hits.map(hit => String(hit.record.id))).not.toContain(String(neighbor.id))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('restores a published snapshot after a provider restart on the same medium', async () => {
    stubEmbeddings({ 'fato a': [1, 0, 0, 0], 'fato b': [1, 0, 0, 0] })
    const pool = new MemoryMediaPool()
    const first = await harness(enabled, pool)
    try {
      await first.ctx.memory.create({ scope, content: 'fato a', source })
      await first.ctx.memory.create({ scope, content: 'fato b', source })
      await vi.waitFor(async () => {
        expect((await first.ctx.memory.graph({ scope })).status).toBe('computed')
      })
    } finally {
      await first.ctx.fiber.dispose()
    }

    const second = await harness(enabled, pool)
    try {
      const snapshot = await second.ctx.memory.graph({ scope })
      expect(snapshot.status === 'computed' || snapshot.status === 'stale').toBe(true)
      expect(snapshot.edges).toHaveLength(1)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('reports stale after a committed correction and recomputes in the background', async () => {
    stubEmbeddings({
      'fato a': [1, 0, 0, 0],
      'fato a corrigido': [1, 0, 0, 0],
      'fato b': [1, 0, 0, 0],
    })
    const { ctx } = await harness(enabled)
    try {
      const created = await ctx.memory.create({ scope, content: 'fato a', source })
      await ctx.memory.create({ scope, content: 'fato b', source })
      await vi.waitFor(async () => {
        expect((await ctx.memory.graph({ scope })).status).toBe('computed')
      })
      await ctx.memory.update({ scope, ref: { id: created.id, revision: 1 }, content: 'fato a corrigido' })
      await vi.waitFor(async () => {
        const snapshot = await ctx.memory.graph({ scope })
        expect(snapshot.status).toBe('computed')
        expect(snapshot.recordRevisions[String(created.id)]).toBe(2)
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
