import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable, KvRecordMutation } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { activeGraphMemoryVersion, MemoryGraphScheduler, type MemoryGraphEvent } from '../src/graph.ts'
import { OllamaSemanticIndex, SemanticSearchError } from '../src/semantic.ts'
import type { LocalMemoryGraph, LocalMemoryRecord } from '../src/spec.ts'

const alpha = WorkspaceId('alpha')
const beta = WorkspaceId('beta')
const a = MemoryId('a')
const b = MemoryId('b')
const start = Date.parse('2026-09-21T00:00:00.000Z')
const at = (offset: number) => new Date(start + offset).toISOString()
type Event = Omit<MemoryGraphEvent, 'schemaVersion'>

function record(overrides: Partial<LocalMemoryRecord> = {}): LocalMemoryRecord {
  return {
    workspaceId: alpha, revision: 1, content: 'synthetic', schemaVersion: 2,
    source: { kind: 'session', sessionId: SessionId('synthetic') },
    createdAt: at(0), updatedAt: at(0), ...overrides,
  }
}

/** Queue and backend latency are controlled explicitly in publication regression tests. */
function table<K extends string, V>(entries: readonly (readonly [K, V])[] = []): KvTable<K, V> {
  const rows = new Map<K, V>(entries)
  const result = {
    get: (key: K) => rows.get(key),
    entries: () => [...rows.entries()][Symbol.iterator](),
    put: async (key: K, value: V) => { rows.set(key, value) },
    delete: async (key: K) => rows.delete(key),
    mutate: async <R>(key: K, decide: (current: V | undefined) => KvRecordMutation<V, R>): Promise<R> => {
      const decision = decide(rows.get(key))
      if (decision.kind === 'put') await result.put(key, decision.value)
      return decision.result
    },
  }
  return result as unknown as KvTable<K, V>
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const schedulers: MemoryGraphScheduler[] = []

function harness(options: {
  memories?: KvTable<MemoryId, LocalMemoryRecord>
  graph?: KvTable<WorkspaceId, LocalMemoryGraph>
  emit?: (event: Event) => void | Promise<void>
  historyMode?: 'v1' | 'temporal-v2'
  maxGraphNodes?: number
  retryAttempts?: number
  retryDelayMs?: number
  retryMaxDelayMs?: number
} = {}) {
  const memories = options.memories ?? table<MemoryId, LocalMemoryRecord>([[a, record()], [b, record()]])
  const graph = options.graph ?? table<WorkspaceId, LocalMemoryGraph>()
  const events: Event[] = []
  const index = new OllamaSemanticIndex({
    baseUrl: 'http://127.0.0.1:8099', model: 'test', dimensions: 64,
    timeoutMs: 100, maxCacheEntries: 10, maxResponseBytes: 10_000,
  })
  const link = vi.spyOn(index, 'link').mockImplementation(async records => ({
    edges: records.length < 2 ? [] : [{ a: records[0]!.id, b: records[1]!.id, score: 0.9 }],
    embeddedCount: records.length, cacheHitCount: 0, durationMs: 0,
  }))
  const scheduler = new MemoryGraphScheduler(graph, memories, index, {
    enabled: true, minScore: 0.75, maxEdgesPerNode: 5,
    maxGraphNodes: options.maxGraphNodes ?? 50, debounceMs: 5, model: 'test', api: 'ollama',
    historyMode: options.historyMode ?? 'temporal-v2',
    retryAttempts: options.retryAttempts ?? 3,
    retryDelayMs: options.retryDelayMs ?? 1000,
    retryMaxDelayMs: options.retryMaxDelayMs ?? 30_000,
  }, options.emit ?? ((event) => { events.push(event) }))
  schedulers.push(scheduler)
  return { memories, graph, events, link, scheduler }
}

afterEach(async () => {
  await Promise.all(schedulers.splice(0).map(scheduler => scheduler.dispose()))
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('graph durable publication and lifecycle', () => {
  it('recovers transient transport without reads or new writes, within one generation', async () => {
    vi.useFakeTimers()
    const { scheduler, graph, link, events } = harness({ retryDelayMs: 20 })
    link.mockRejectedValueOnce(new SemanticSearchError('TRANSPORT'))
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(5)
    expect(graph.get(alpha)).toMatchObject({ status: 'failed', failureCode: 'TRANSPORT' })
    await vi.advanceTimersByTimeAsync(25)
    expect(graph.get(alpha)).toMatchObject({ status: 'computed', generation: 1 })
    expect(graph.get(alpha)?.failureCode).toBeUndefined()
    expect(events.map(event => event.status)).toEqual(['failed', 'computed'])
    expect(link).toHaveBeenCalledTimes(2)
  })

  it('bounds retries, caps exponential delays and resets the allowance only after a new commit', async () => {
    vi.useFakeTimers()
    const { scheduler, graph, link } = harness({ retryAttempts: 3, retryDelayMs: 10, retryMaxDelayMs: 15 })
    link.mockRejectedValue(new SemanticSearchError('HTTP_ERROR', true))
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(500)
    expect(link).toHaveBeenCalledTimes(4)
    expect(graph.get(alpha)?.status).toBe('failed')
    expect(vi.getTimerCount()).toBe(0)
    scheduler.snapshot(alpha)
    await vi.advanceTimersByTimeAsync(500)
    expect(link).toHaveBeenCalledTimes(4)
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(500)
    expect(link).toHaveBeenCalledTimes(8)
    expect(graph.get(alpha)?.generation).toBe(2)
  })

  it.each(['dispose', 'disable'] as const)('cancels a delayed retry on %s and leaves no timer', async (action) => {
    vi.useFakeTimers()
    const { scheduler, link } = harness({ retryDelayMs: 20 })
    link.mockRejectedValue(new SemanticSearchError('TRANSPORT'))
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(5)
    if (action === 'dispose') await scheduler.dispose()
    else await scheduler.setEnabled(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(link).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains exact prior coverage on irrecoverable failure without presenting it as current', async () => {
    vi.useFakeTimers()
    const { scheduler, memories, graph, link } = harness()
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(5)
    const previous = graph.get(alpha)!
    await memories.put(a, record({ revision: 2, content: 'changed synthetic record' }))
    link.mockRejectedValue(new SemanticSearchError('INPUT_TOO_LARGE'))
    scheduler.dirty(alpha)
    await vi.advanceTimersByTimeAsync(100)
    expect(graph.get(alpha)).toMatchObject({ status: 'failed', failureCode: 'INPUT_TOO_LARGE',
      recordRevisions: previous.recordRevisions, edges: previous.edges, computedAt: previous.computedAt })
    expect(scheduler.snapshot(alpha).status).toBe('failed')
    expect(memories.get(a)?.content).toBe('changed synthetic record')
    expect(link).toHaveBeenCalledTimes(2)
  })

  it('reports an unseen idle empty scope without scheduling, embedding, or persisting on reads', async () => {
    vi.useFakeTimers()
    const { scheduler, graph, link } = harness({ memories: table() })
    expect(scheduler.snapshot(alpha)).toEqual({ row: undefined, status: 'empty' })
    scheduler.snapshot(alpha)
    scheduler.snapshot(beta)
    await vi.advanceTimersByTimeAsync(100)
    expect(link).not.toHaveBeenCalled()
    expect(graph.get(alpha)).toBeUndefined()
    expect(graph.get(beta)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps an empty scope pending while its own generation is queued or publishing', async () => {
    const { scheduler, graph, link } = harness({ memories: table() })
    const gate = deferred()
    link.mockImplementationOnce(async () => {
      await gate.promise
      return { edges: [], embeddedCount: 0, cacheHitCount: 0, durationMs: 0 }
    })
    try {
      scheduler.dirty(alpha)
      expect(scheduler.snapshot(alpha).status).toBe('pending')
      await vi.waitFor(() => { expect(link).toHaveBeenCalledTimes(1) })
      expect(scheduler.snapshot(alpha)).toEqual({ row: undefined, status: 'pending' })
      expect(scheduler.snapshot(beta)).toEqual({ row: undefined, status: 'empty' })
    } finally {
      gate.resolve()
    }
    await vi.waitFor(() => { expect(graph.get(alpha)?.status).toBe('empty') })
    expect(scheduler.snapshot(alpha).status).toBe('empty')
  })

  it('retains pending for existing active records that have no graph yet', () => {
    const { scheduler } = harness()
    expect(scheduler.snapshot(alpha)).toEqual({ row: undefined, status: 'pending' })
  })

  it('emits success only after the backend confirms the snapshot', async () => {
    const { scheduler, graph, events } = harness()
    const gate = deferred()
    const original = graph.put.bind(graph)
    const put = vi.spyOn(graph, 'put').mockImplementation(async (key, value) => {
      await gate.promise
      await original(key, value)
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(1) })
    expect(graph.get(alpha)).toBeUndefined()
    expect(events).toEqual([])
    gate.resolve()
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(graph.get(alpha)?.status).toBe('computed')
    expect(events[0]?.status).toBe('computed')
  })

  it('contains durable-write rejection without announcing a completed computation or retrying', async () => {
    const { scheduler, graph, events } = harness()
    const put = vi.spyOn(graph, 'put').mockRejectedValue(new Error('private backend details'))
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({ status: 'failed', failureCode: 'persistence-failed' })
    expect(JSON.stringify(events)).not.toContain('private')
    expect(graph.get(alpha)).toBeUndefined()
    await scheduler.dispose()
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('checks generation again at the queued mutation slot and omits the discarded event', async () => {
    const { scheduler, graph, events } = harness()
    const gate = deferred()
    const original = graph.mutate.bind(graph)
    let first = true
    const mutation = vi.spyOn(graph, 'mutate').mockImplementation(async (key, decide) => {
      if (first) { first = false; await gate.promise }
      return original(key, decide)
    })
    const put = vi.spyOn(graph, 'put')
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(mutation).toHaveBeenCalledTimes(1) })
    scheduler.dirty(alpha)
    gate.resolve()
    await vi.waitFor(() => { expect(graph.get(alpha)?.generation).toBe(2) })
    expect(put).toHaveBeenCalledTimes(1)
    expect(events.map(event => event.generation)).toEqual([2])
  })

  it('suppresses success when a committed input changes during backend persistence', async () => {
    const { scheduler, graph, events } = harness()
    const gate = deferred()
    const original = graph.put.bind(graph)
    let first = true
    const put = vi.spyOn(graph, 'put').mockImplementation(async (key, value) => {
      if (first) { first = false; await gate.promise }
      await original(key, value)
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(1) })
    scheduler.dirty(alpha)
    gate.resolve()
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]?.generation).toBe(2)
  })

  it('checks committed revisions at the queue slot even before the provider delivers its dirty mark', async () => {
    const { scheduler, graph, memories, events } = harness()
    const gate = deferred()
    const original = graph.mutate.bind(graph)
    let first = true
    const mutation = vi.spyOn(graph, 'mutate').mockImplementation(async (key, decide) => {
      if (first) { first = false; await gate.promise }
      return original(key, decide)
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(mutation).toHaveBeenCalledTimes(1) })
    await memories.delete(a)
    gate.resolve()
    await vi.waitFor(() => { expect(graph.get(alpha)?.recordRevisions).toEqual({ b: 1 }) })
    expect(events.map(event => event.generation)).toEqual([2])
    expect(graph.get(alpha)?.edges).toEqual([])
  })

  it('awaits a submitted durable write at disposal and suppresses late notifications', async () => {
    const { scheduler, graph, events } = harness()
    const gate = deferred()
    const original = graph.put.bind(graph)
    const put = vi.spyOn(graph, 'put').mockImplementation(async (key, value) => {
      await gate.promise
      await original(key, value)
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(1) })
    let done = false
    const disposal = scheduler.dispose().then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    gate.resolve()
    await disposal
    expect(done).toBe(true)
    expect(events).toEqual([])
    expect(graph.get(alpha)).toBeDefined()
    scheduler.dirty(alpha)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('aborts and drains an active embedding before disposal resolves', async () => {
    const { scheduler, link, graph, events } = harness()
    const gate = deferred()
    let observedAbort = false
    link.mockImplementationOnce(async (_records, _min, _max, signal) => {
      signal!.addEventListener('abort', () => { observedAbort = true })
      await gate.promise
      return { edges: [], embeddedCount: 0, cacheHitCount: 0, durationMs: 0 }
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(link).toHaveBeenCalledTimes(1) })
    let done = false
    const disposal = scheduler.dispose().then(() => { done = true })
    await Promise.resolve()
    expect(observedAbort).toBe(true)
    expect(done).toBe(false)
    gate.resolve()
    await disposal
    expect(graph.get(alpha)).toBeUndefined()
    expect(events).toEqual([])
  })

  it.each(['sync', 'async'] as const)('contains a %s observer failure and continues the next scope', async (kind) => {
    const seen: WorkspaceId[] = []
    const { scheduler, graph } = harness({ emit: (event) => {
      seen.push(event.workspaceId)
      if (kind === 'sync') throw new Error('observer')
      return Promise.reject(new Error('observer'))
    } })
    scheduler.dirty(alpha)
    scheduler.dirty(beta)
    await vi.waitFor(() => { expect(seen).toEqual([alpha, beta]) })
    expect(graph.get(alpha)?.status).toBe('computed')
    expect(graph.get(beta)?.status).toBe('empty')
  })

  it.each(['INVALID_RESPONSE', 'INPUT_TOO_LARGE', 'TIMEOUT'] as const)('persists sanitized %s without retrying on reads', async (code) => {
    const { scheduler, graph, events, link } = harness()
    link.mockRejectedValue(new SemanticSearchError(code))
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(graph.get(alpha)).toMatchObject({ status: 'failed', failureCode: code })
    expect(events[0]?.failureCode).toBe(code)
    scheduler.snapshot(alpha)
    scheduler.snapshot(alpha)
    await scheduler.dispose()
    expect(link).toHaveBeenCalledTimes(1)
  })

  it('disables in-flight work without publication and seeds known scopes after reactivation', async () => {
    const { scheduler, graph, link, events } = harness()
    const gate = deferred()
    let observedAbort = false
    link.mockImplementationOnce(async (_records, _min, _max, signal) => {
      signal!.addEventListener('abort', () => { observedAbort = true })
      await gate.promise
      return { edges: [], embeddedCount: 2, cacheHitCount: 0, durationMs: 0 }
    })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(link).toHaveBeenCalledTimes(1) })
    let stopped = false
    const disable = scheduler.setEnabled(false).then(() => { stopped = true })
    await Promise.resolve()
    expect(observedAbort).toBe(true)
    expect(stopped).toBe(false)
    scheduler.dirty(alpha)
    gate.resolve()
    await disable
    expect(graph.get(alpha)).toBeUndefined()
    expect(events).toEqual([])
    expect(scheduler.snapshot(alpha)).toEqual({ row: undefined, status: 'unavailable' })
    await scheduler.setEnabled(false)
    expect(link).toHaveBeenCalledTimes(1)
    await scheduler.setEnabled(true)
    await vi.waitFor(() => { expect(graph.get(alpha)?.status).toBe('computed') })
    expect(events).toHaveLength(1)
    expect(link).toHaveBeenCalledTimes(2)
  })

  it('cancels debounce and temporal wakes while disabled even when activation deadlines pass', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const { scheduler, graph, link } = harness({ memories: table([
      [a, record({ validFrom: at(100) })], [b, record()],
    ]) })
    scheduler.seedExisting()
    await scheduler.setEnabled(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(link).not.toHaveBeenCalled()
    expect(graph.get(alpha)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await scheduler.setEnabled(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ a: 1, b: 1 })
    await scheduler.dispose()
    await scheduler.setEnabled(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('graph temporal lifecycle and recovery', () => {
  it('rebuilds expired memories without any read and cancels future timers at disposal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const { scheduler, graph, link } = harness({ memories: table([
      [a, record({ expiresAt: at(100) })], [b, record()],
    ]) })
    scheduler.seedExisting()
    await vi.advanceTimersByTimeAsync(10)
    expect(graph.get(alpha)?.edges).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ b: 1 })
    expect(graph.get(alpha)?.edges).toEqual([])
    expect(link).toHaveBeenCalledTimes(2)
    await scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the active historical revision until a scheduled correction takes effect', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const prior = record({ validFrom: at(-1_000), validUntil: at(100), supersededBy: { id: a, revision: 2 } })
    const next = record({ revision: 2, content: 'future', validFrom: at(100), history: [prior] })
    const { scheduler, graph, link } = harness({ memories: table([[a, next], [b, record()]]) })
    scheduler.seedExisting()
    await vi.advanceTimersByTimeAsync(10)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ a: 1, b: 1 })
    expect(link.mock.calls[0]?.[0][0]?.content).toBe('synthetic')
    await vi.advanceTimersByTimeAsync(100)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ a: 2, b: 1 })
    expect(graph.get(alpha)?.edges[0]?.a.revision).toBe(2)
  })

  it('does not revive historical revisions in the v1 profile', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const { scheduler, graph } = harness({ historyMode: 'v1', memories: table([
      [a, record({ revision: 2, validFrom: at(100), history: [record()] })], [b, record()],
    ]) })
    scheduler.seedExisting()
    await vi.advanceTimersByTimeAsync(10)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ b: 1 })
    await vi.advanceTimersByTimeAsync(100)
    expect(graph.get(alpha)?.recordRevisions).toEqual({ a: 2, b: 1 })
  })

  it('clears a stored graph after restart when the last memory was already forgotten', async () => {
    const first = harness()
    first.scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(first.graph.get(alpha)?.edges).toHaveLength(1) })
    await first.scheduler.dispose()
    await first.memories.delete(a)
    await first.memories.delete(b)
    const restarted = harness({ memories: first.memories, graph: first.graph })
    restarted.scheduler.seedExisting()
    await vi.waitFor(() => { expect(restarted.graph.get(alpha)?.status).toBe('empty') })
    expect(restarted.graph.get(alpha)?.recordRevisions).toEqual({})
    expect(restarted.graph.get(alpha)?.edges).toEqual([])
    expect(restarted.graph.get(alpha)?.generation).toBe(2)
  })

  it('discards a computation crossing an expiry boundary and publishes the recomputation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const { scheduler, graph, link, events } = harness({ memories: table([
      [a, record({ expiresAt: at(100) })], [b, record()],
    ]) })
    const gate = deferred()
    link.mockImplementationOnce(async () => {
      await gate.promise
      return { edges: [{ a, b, score: 0.9 }], embeddedCount: 2, cacheHitCount: 0, durationMs: 0 }
    })
    scheduler.seedExisting()
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(100)
    gate.resolve()
    await vi.advanceTimersByTimeAsync(10)
    expect(events.map(event => event.generation)).toEqual([2])
    expect(graph.get(alpha)?.recordRevisions).toEqual({ b: 1 })
  })

  it('bounds failure snapshots when the active node limit is exceeded', async () => {
    const { scheduler, graph, link } = harness({ maxGraphNodes: 1 })
    scheduler.dirty(alpha)
    await vi.waitFor(() => { expect(graph.get(alpha)?.status).toBe('failed') })
    expect(graph.get(alpha)?.failureCode).toBe('graph-limit-exceeded')
    expect(graph.get(alpha)?.recordRevisions).toEqual({})
    expect(link).not.toHaveBeenCalled()
  })

  it('rejects invalid temporal metadata instead of treating NaN comparisons as active', () => {
    expect(activeGraphMemoryVersion(record({ expiresAt: 'invalid' }), 'temporal-v2', start)).toBeUndefined()
    expect(activeGraphMemoryVersion(record({ validFrom: at(10), validUntil: at(0) }), 'temporal-v2', start)).toBeUndefined()
    expect(activeGraphMemoryVersion(record({ validFrom: at(0), expiresAt: at(0) }), 'temporal-v2', start)).toBeUndefined()
    expect(activeGraphMemoryVersion(record({ supersedes: { id: a, revision: 0 } }), 'temporal-v2', start)).toBeUndefined()
  })
})
