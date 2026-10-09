import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MemoryId, type MemoryRecord } from '@deepseek-ai/dsh-memory'
import { OllamaSemanticIndex, type OllamaSemanticIndexConfig } from '../src/semantic.ts'

afterEach(() => { vi.unstubAllGlobals() })

function index(overrides: Partial<OllamaSemanticIndexConfig> = {}) {
  return new OllamaSemanticIndex({
    baseUrl: 'http://127.0.0.1:8099', model: 'synthetic', dimensions: 64,
    timeoutMs: 1000, maxCacheEntries: 10, maxResponseBytes: 100_000,
    ...overrides,
  })
}

function records(content: string) {
  return ['first', 'second'].map(id => ({ id: MemoryId(id), revision: 1, content }))
}

function success(inputs: readonly string[], api = 'ollama') {
  const vectors = inputs.map(() => Array.from({ length: 64 }, (_, axis) => axis === 0 ? 1 : 0))
  return new Response(JSON.stringify(api === 'ollama' ? { embeddings: vectors }
    : { data: vectors.map((embedding, index) => ({ embedding, index })).reverse() }))
}

function overflow() {
  return new Response(JSON.stringify({ error: { code: 'context_length_exceeded' } }), { status: 400 })
}

describe('bounded complete graph embeddings', () => {
  it('weights every chunk by its full length and keeps segmented graph vectors out of retrieval cache', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { input } = JSON.parse(z.string().parse(init?.body)) as { input: string[] }
      return new Response(JSON.stringify({ embeddings: input.map(text =>
        Array.from({ length: 64 }, (_, axis) => axis === (text.endsWith('BB') ? 1 : 0) ? 1 : 0)) }))
    })
    vi.stubGlobal('fetch', fetch)
    const semantic = index({ graphInputCharacters: 4 })
    const candidates = [{ id: MemoryId('first'), revision: 1, content: 'AAAABB' },
      { id: MemoryId('second'), revision: 1, content: 'AAAA' }]
    const queryCandidates = candidates.map(record => ({ record: record as MemoryRecord }))
    await semantic.rank('synthetic', queryCandidates)
    const graph = await semantic.link(candidates, 0, 2)
    expect(graph).toMatchObject({ embeddedCount: 2, cacheHitCount: 0 })
    expect(graph.edges[0]?.score).toBeCloseTo(2 / Math.sqrt(5))
    expect(await semantic.rank('synthetic', queryCandidates)).toMatchObject({ embeddedCount: 2, cacheHitCount: 0 })
    expect(await semantic.link(candidates, 0, 2)).toMatchObject({ embeddedCount: 2, cacheHitCount: 0 })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it.each(['ollama', 'openai-compatible'] as const)('segments all Unicode content into bounded %s batches', async (api) => {
    const content = 'A😀  café\n'.repeat(20)
    const received: string[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(z.string().parse(init?.body)) as { input: string[]; truncate?: boolean }
      expect(body.input.length).toBeLessThanOrEqual(3)
      if (api === 'ollama') expect(body.truncate).toBe(false)
      for (const value of body.input) {
        expect(value.startsWith('search_document: ')).toBe(true)
        const text = value.slice('search_document: '.length)
        expect(text.length).toBeLessThanOrEqual(8)
        expect(/\p{Surrogate}/u.test(text)).toBe(false)
        received.push(text)
      }
      return success(body.input, api)
    })
    vi.stubGlobal('fetch', fetch)
    const semantic = index({ api, graphInputCharacters: 8, graphBatchInputs: 3 })
    expect(await semantic.link(records(content), 0.9, 2)).toMatchObject({ embeddedCount: 2, edges: [{ score: 1 }] })
    expect(received.join('')).toBe(content + content)
    const calls = fetch.mock.calls.length
    expect(await semantic.link(records(content), 0.9, 2)).toMatchObject({ embeddedCount: 0, cacheHitCount: 2 })
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it('splits an oversized batch first, then singleton chunks, preserving complete input order', async () => {
    const content = '😀abcdefghij'.repeat(8)
    const accepted: string[] = []
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { input } = JSON.parse(z.string().parse(init?.body)) as { input: string[] }
      const texts = input.map(value => value.slice('search_document: '.length))
      requests.push(texts)
      if (input.length > 1 || texts.some(text => text.length > 15)) return overflow()
      accepted.push(...texts)
      return success(input)
    }))
    const result = await index({ graphInputCharacters: 80, graphBatchInputs: 4 }).link(records(content), 0.9, 2)
    expect(result.edges).toHaveLength(1)
    expect(accepted.join('')).toBe(content + content)
    expect(requests[0]).toHaveLength(4)
    expect(requests[1]).toHaveLength(2)
    expect(requests[2]).toHaveLength(1)
  })

  it('fails explicitly at the subdivision limit and does not cache incomplete document coverage', async () => {
    const fetch = vi.fn(async () => overflow())
    vi.stubGlobal('fetch', fetch)
    const semantic = index({ graphInputSplitDepth: 2 })
    await expect(semantic.link(records('abcdefghijklmnop'), 0.9, 2)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    expect(fetch).toHaveBeenCalledTimes(4)
    fetch.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const { input } = JSON.parse(z.string().parse(init?.body)) as { input: string[] }
      return success(input)
    })
    expect(await semantic.link(records('abcdefghijklmnop'), 0.9, 2)).toMatchObject({ embeddedCount: 2, cacheHitCount: 0 })
  })

  it('does not subdivide an indivisible Unicode character', async () => {
    const fetch = vi.fn(async () => overflow())
    vi.stubGlobal('fetch', fetch)
    await expect(index().link(records('😀'), 0.9, 2)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops before submitting another chunk when the caller cancels', async () => {
    const controller = new AbortController()
    const reason = new Error('synthetic caller cancellation')
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { input } = JSON.parse(z.string().parse(init?.body)) as { input: string[] }
      const result = success(input)
      controller.abort(reason)
      return result
    })
    vi.stubGlobal('fetch', fetch)
    await expect(index({ graphInputCharacters: 4, graphBatchInputs: 1 })
      .link(records('long document'), 0.9, 2, controller.signal)).rejects.toBe(reason)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds the complete pass independently of the per-request timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('synthetic abort')) }, { once: true })
    })))
    await expect(index({ timeoutMs: 1000, graphTimeoutMs: 10 }).link(records('synthetic'), 0.9, 2))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
