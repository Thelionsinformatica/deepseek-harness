import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryId, type MemoryRecord } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  OllamaSemanticIndex,
  type OllamaSemanticIndexConfig,
  type SemanticCandidate,
} from '../src/semantic.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function config(overrides: Partial<OllamaSemanticIndexConfig> = {}): OllamaSemanticIndexConfig {
  return {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'nomic-embed-text:latest',
    dimensions: 64,
    timeoutMs: 1_000,
    maxCacheEntries: 8,
    maxResponseBytes: 1_000_000,
    ...overrides,
  }
}

function candidate(id: string, content: string, revision = 1): SemanticCandidate {
  const record: MemoryRecord = {
    id: MemoryId(id),
    scope: { workspaceId: WorkspaceId('workspace-alpha') },
    content,
    revision,
    source: { kind: 'session', sessionId: SessionId('session-alpha') },
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  }
  return { record }
}

function unitVector(axis = 0): number[] {
  return Array.from({ length: 64 }, (_value, index) => index === axis ? 1 : 0)
}

function responseFor(inputs: readonly string[]): Response {
  return new Response(JSON.stringify({
    model: 'nomic-embed-text:latest',
    embeddings: inputs.map(() => unitVector()),
  }), { status: 200 })
}

describe('Ollama local semantic index', () => {
  it('returns an empty ranking without contacting Ollama when the workspace has no candidates', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const index = new OllamaSemanticIndex(config())

    await expect(index.rank('consulta', [])).resolves.toMatchObject({
      scores: new Map(),
      embeddedCount: 0,
      cacheHitCount: 0,
      durationMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds the LRU index and re-embeds only the evicted document', async () => {
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected serialized body')
      const body = JSON.parse(init.body) as { input: string[] }
      batches.push(body.input)
      return responseFor(body.input)
    }))
    const index = new OllamaSemanticIndex(config({ maxCacheEntries: 1 }))
    const candidates = [candidate('one', 'Documento um.'), candidate('two', 'Documento dois.')]

    await index.rank('primeira', candidates)
    const second = await index.rank('segunda', candidates)

    expect(batches.map(batch => batch.length)).toEqual([3, 2])
    expect(second).toMatchObject({ embeddedCount: 1, cacheHitCount: 1 })
    index.invalidate(MemoryId('two'))
  })

  it.each([
    ['HTTP_ERROR', () => new Response('', { status: 503 })],
    ['INVALID_RESPONSE', () => new Response('{not json', { status: 200 })],
    ['INVALID_RESPONSE', () => new Response('null', { status: 200 })],
    ['INVALID_RESPONSE', () => new Response('{}', { status: 200 })],
    ['INVALID_RESPONSE', () => new Response(JSON.stringify({ embeddings: [] }), { status: 200 })],
    ['INVALID_RESPONSE', () => new Response(JSON.stringify({ embeddings: [[1], [1]] }), { status: 200 })],
    ['INVALID_RESPONSE', () => new Response(JSON.stringify({
      embeddings: [unitVector(), [...unitVector().slice(0, 63), 'bad']],
    }), { status: 200 })],
    ['RESPONSE_TOO_LARGE', () => new Response('large', {
      status: 200,
      headers: { 'content-length': '1000001' },
    })],
    ['INVALID_RESPONSE', () => new Response(null, { status: 200 })],
  ] as const)('classifies %s without exposing the response body', async (code, makeResponse) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(makeResponse())))
    const index = new OllamaSemanticIndex(config())
    await expect(index.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code })
  })

  it('ignores a non-numeric content-length and validates the actual bounded body', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      embeddings: [unitVector(), unitVector()],
    }), { status: 200, headers: { 'content-length': 'unknown' } }))))
    const index = new OllamaSemanticIndex(config())

    await expect(index.rank('consulta', [candidate('one', 'Documento.')]))
      .resolves.toMatchObject({ embeddedCount: 1, cacheHitCount: 0 })
  })

  it('stops reading an oversized chunked response', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(100)))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))
    const index = new OllamaSemanticIndex(config({ maxResponseBytes: 10 }))
    await expect(index.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('classifies local timeout and transport failures separately', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) throw new TypeError('expected request signal')
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const reason: unknown = signal.reason
          reject(reason instanceof Error ? reason : new Error('request aborted'))
        }, { once: true })
      })
    }))
    const timed = new OllamaSemanticIndex(config({ timeoutMs: 1 }))
    await expect(timed.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'TIMEOUT' })

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    const offline = new OllamaSemanticIndex(config())
    await expect(offline.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('propagates caller cancellation during connect and body delivery', async () => {
    const connectAbort = new AbortController()
    connectAbort.abort(new Error('cancelled by caller'))
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      const reason: unknown = signal instanceof AbortSignal ? signal.reason : undefined
      return Promise.reject(reason instanceof Error ? reason : new Error('missing signal'))
    }))
    const index = new OllamaSemanticIndex(config())
    await expect(index.rank('consulta', [candidate('one', 'Documento.')], connectAbort.signal))
      .rejects.toThrow('cancelled by caller')

    const bodyAbort = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{}'))
          controller.close()
        }, 5)
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => {
      setTimeout(() => {
        bodyAbort.abort('cancelled without Error')
      }, 1)
      return Promise.resolve(new Response(body, { status: 200 }))
    }))
    await expect(index.rank('consulta', [candidate('one', 'Documento.')], bodyAbort.signal))
      .rejects.toThrow('memory semantic search aborted')
  })

  it('returns zero cosine score for a zero-length semantic direction', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      embeddings: [Array(64).fill(0), unitVector()],
    }), { status: 200 }))))
    const index = new OllamaSemanticIndex(config())
    const ranking = await index.rank('consulta', [candidate('one', 'Documento.')])
    expect(ranking.scores.get(MemoryId('one'))).toBe(0)
  })
})
