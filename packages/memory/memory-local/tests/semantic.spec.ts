import { createServer } from 'node:http'
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

  it.each([400, 500])('bounds a streamed HTTP %s error before classifying it', async (status) => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('é'.repeat(6))) },
      cancel: cancelled,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
    const index = new OllamaSemanticIndex(config({ maxResponseBytes: 10 }))
    await expect(index.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it.each([
    [400, { error: { code: 'context_length_exceeded', message: 'private-response-text' } }, 'INPUT_TOO_LARGE'],
    [400, { error: { type: 'exceed_context_size_error' } }, 'INPUT_TOO_LARGE'],
    [413, { error: { code: 'context_window_exceeded' } }, 'INPUT_TOO_LARGE'],
    [422, { error: 'the input length exceeds the context length' }, 'INPUT_TOO_LARGE'],
    [400, { error: { message: 'request (3000 tokens) exceeds the available context size (2048 tokens), try increasing it' } }, 'INPUT_TOO_LARGE'],
    [500, { error: { message: 'out of memory; private-response-text' } }, 'HTTP_ERROR'],
    [503, { error: { code: 'context_length_exceeded' } }, 'HTTP_ERROR'],
    [400, { error: { message: 'private note mentions context or physical batch size' } }, 'HTTP_ERROR'],
    [400, { error: null }, 'HTTP_ERROR'],
    [400, null, 'HTTP_ERROR'],
    [400, {}, 'HTTP_ERROR'],
  ] as const)('classifies HTTP %s without retaining provider detail: %j', async (status, body, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    const index = new OllamaSemanticIndex(config())
    await expect(index.rank('private-query', [candidate('one', 'private-document')]))
      .rejects.toMatchObject({ code, message: `local semantic search failed: ${code}` })
  })

  it('keeps invalid HTTP error bodies generic rather than exposing or parsing them as embeddings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-invalid-json', { status: 500 })))
    await expect(new OllamaSemanticIndex(config()).rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', message: 'local semantic search failed: HTTP_ERROR' })
  })

  it.each(['ollama', 'openai-compatible'] as const)('does not truncate or retry oversized %s input', async (api) => {
    const longContent = 'conteúdo privado '.repeat(1000)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected serialized body')
      expect(JSON.parse(init.body)).toEqual({
        model: 'nomic-embed-text:latest',
        input: ['search_query: consulta', `search_document: ${longContent}`],
        ...(api === 'ollama' ? { truncate: false, dimensions: 64 } : {}),
      })
      expect(init.redirect).toBe('error')
      return new Response(JSON.stringify({ error: {
        code: 500,
        message: 'input (970 tokens) is too large to process. increase the physical batch size (current batch size: 512)',
        type: 'server_error',
      } }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(new OllamaSemanticIndex(config({ api })).rank('consulta', [candidate('one', longContent)]))
      .rejects.toMatchObject({ code: 'INPUT_TOO_LARGE', message: 'local semantic search failed: INPUT_TOO_LARGE' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([307, 308])('never follows HTTP %s with a memory-bearing POST through real fetch', async (status) => {
    let redirectedRequests = 0
    const entryRequests: string[] = []
    const server = createServer((request, response) => {
      if (request.url === '/must-not-receive') {
        redirectedRequests++
        response.writeHead(500).end()
        return
      }
      entryRequests.push(request.url ?? '')
      response.writeHead(status, { location: '/must-not-receive' }).end()
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('expected loopback test port')
      for (const api of ['ollama', 'openai-compatible'] as const) {
        const index = new OllamaSemanticIndex(config({ api, baseUrl: `http://127.0.0.1:${address.port}` }))
        await expect(index.rank('consulta', [candidate('one', 'Documento privado sintético.')]))
          .rejects.toMatchObject({ code: 'TRANSPORT', message: 'local semantic search failed: TRANSPORT' })
      }
      expect(entryRequests).toEqual(['/api/embed', '/v1/embeddings'])
      expect(redirectedRequests).toBe(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
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

describe('OpenAI-compatible embedding dialect', () => {
  it('posts to /v1/embeddings without Ollama fields and orders rows by index', async () => {
    const seen: { url?: string; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      seen.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      seen.body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
      return Promise.resolve(new Response(JSON.stringify({
        data: [
          { index: 1, embedding: unitVector(1) },
          { index: 0, embedding: unitVector(0) },
        ],
      }), { status: 200 }))
    }))
    const index = new OllamaSemanticIndex(config({ api: 'openai-compatible', baseUrl: 'http://127.0.0.1:8099' }))
    const ranking = await index.rank('consulta', [candidate('one', 'Documento.')])

    expect(seen.url).toBe('http://127.0.0.1:8099/v1/embeddings')
    expect(seen.body).toEqual({ model: 'nomic-embed-text:latest', input: ['search_query: consulta', 'search_document: Documento.'] })
    expect(ranking.scores.get(MemoryId('one'))).toBe(0)
  })

  it('maps every reordered row to its exact input index rather than response position', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { index: 2, embedding: unitVector(1) },
        { index: 0, embedding: unitVector(0) },
        { index: 1, embedding: unitVector(0) },
      ],
    }), { status: 200 })))
    const index = new OllamaSemanticIndex(config({ api: 'openai-compatible' }))
    const ranking = await index.rank('consulta', [candidate('one', 'Relacionado.'), candidate('two', 'Outro tema.')])
    expect(ranking.scores).toEqual(new Map([[MemoryId('one'), 1], [MemoryId('two'), 0]]))
  })

  it.each([
    ['duplicate', [0, 0]],
    ['missing', [0, undefined]],
    ['negative', [-1, 1]],
    ['outside range', [0, 2]],
    ['fractional', [0, 0.5]],
    ['string', [0, '1']],
    ['null', [0, null]],
    ['boolean', [0, true]],
    ['unsafe integer', [0, Number.MAX_SAFE_INTEGER + 1]],
  ] as const)('rejects %s indices rather than assigning vectors to the wrong memory', async (_label, indices) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: indices.map(index => ({ index, embedding: unitVector() })),
    }), { status: 200 })))
    await expect(new OllamaSemanticIndex(config({ api: 'openai-compatible' })).rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each([null, false, 'row', 3, []])('rejects a non-object embedding row %j as INVALID_RESPONSE', async (row) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: unitVector() }, row],
    }), { status: 200 })))
    await expect(new OllamaSemanticIndex(config({ api: 'openai-compatible' })).rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('does not populate the document cache after an invalid indexed batch', async () => {
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { input: string[] }
      batches.push(body.input)
      return new Response(JSON.stringify({
        data: body.input.map((_item, position) => ({
          index: batches.length === 1 ? 0 : position,
          embedding: unitVector(),
        })),
      }), { status: 200 })
    }))
    const index = new OllamaSemanticIndex(config({ api: 'openai-compatible' }))
    const records = [candidate('one', 'Documento.')]
    await expect(index.rank('consulta', records)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(index.rank('consulta', records)).resolves.toMatchObject({ embeddedCount: 1, cacheHitCount: 0 })
    expect(batches.map(batch => batch.length)).toEqual([2, 2])
  })

  it.each([
    ['{}'],
    [JSON.stringify({ data: [] })],
    [JSON.stringify({ data: [{ embedding: [1, 2] }] })],
    [JSON.stringify({ data: [{ embedding: [...unitVector().slice(0, 63), Number.NaN] }] })],
    [JSON.stringify({ data: [{ embedding: unitVector() }, { embedding: unitVector() }, { embedding: unitVector() }] })],
  ])('rejects malformed payload %s as INVALID_RESPONSE', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(payload, { status: 200 }))))
    const index = new OllamaSemanticIndex(config({ api: 'openai-compatible' }))
    await expect(index.rank('consulta', [candidate('one', 'Documento.')]))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('pairwise memory linking', () => {
  function linked(id: string, content: string, revision = 1) {
    return { id: MemoryId(id), revision, content }
  }

  function stubPairwise(vectors: Record<string, readonly number[]>): void {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected serialized body')
      const body = JSON.parse(init.body) as { input: string[] }
      return new Response(JSON.stringify({
        embeddings: body.input.map((input) => {
          const key = input.replace('search_document: ', '')
          const vector = vectors[key]
          if (vector === undefined) throw new TypeError(`unstubbed input: ${key}`)
          return [...vector]
        }),
      }), { status: 200 })
    }))
  }

  it('embeds each document once, emits canonical pairs above the threshold', async () => {
    stubPairwise({ 'fato a': unitVector(0), 'fato b': unitVector(0), 'fato c': unitVector(1) })
    const index = new OllamaSemanticIndex(config())
    const linking = await index.link(
      [linked('mem-b', 'fato b'), linked('mem-a', 'fato a'), linked('mem-c', 'fato c')],
      0.9,
      5,
    )
    expect(linking.edges).toEqual([{ a: MemoryId('mem-a'), b: MemoryId('mem-b'), score: 1 }])
    expect(linking.embeddedCount).toBe(3)
  })

  it('keeps only the strongest maxPerNode edges per node', async () => {
    stubPairwise({
      'centro': unitVector(0),
      'igual um': unitVector(0),
      'igual dois': unitVector(0),
      'igual tres': unitVector(0),
    })
    const index = new OllamaSemanticIndex(config())
    const linking = await index.link(
      [
        linked('centro', 'centro'),
        linked('um', 'igual um'),
        linked('dois', 'igual dois'),
        linked('tres', 'igual tres'),
      ],
      0.5,
      2,
    )
    const centerEdges = linking.edges.filter(edge => edge.a === MemoryId('centro') || edge.b === MemoryId('centro'))
    expect(centerEdges.length).toBeLessThanOrEqual(2)
    const degree = new Map<string, number>()
    for (const edge of linking.edges) {
      for (const id of [edge.a, edge.b]) degree.set(String(id), (degree.get(String(id)) ?? 0) + 1)
    }
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(2)
  })

  it('returns an empty pass without contacting the endpoint for fewer than two candidates', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const index = new OllamaSemanticIndex(config())
    await expect(index.link([linked('mem-a', 'fato a')], 0.5, 5))
      .resolves.toMatchObject({ edges: [], embeddedCount: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses the revision-keyed cache across linking passes', async () => {
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { input: string[] }
      batches.push(body.input)
      return new Response(JSON.stringify({
        embeddings: body.input.map(() => unitVector(0)),
      }), { status: 200 })
    }))
    const index = new OllamaSemanticIndex(config())
    const candidates = [linked('mem-a', 'fato a'), linked('mem-b', 'fato b')]
    await index.link(candidates, 0.9, 5)
    const second = await index.link(candidates, 0.9, 5)
    expect(batches).toHaveLength(1)
    expect(second).toMatchObject({ embeddedCount: 0, cacheHitCount: 2 })
  })
})
