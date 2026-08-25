import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime, { MemoryId } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** Mount the real memory seam and local provider over a controllable durable medium. */
async function harness(
  pool = new MemoryMediaPool(),
  config: MemoryLocal.Config = {},
  directApply = false,
) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(MemoryRuntime, { provider: 'local' })
  try {
    if (directApply) await MemoryLocal.apply(ctx, config)
    else await ctx.plugin(MemoryLocal, config)
    return { ctx, pool }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Unit vector used by the deterministic Ollama transport fixture. */
function unitVector(axis: number): number[] {
  return Array.from({ length: 64 }, (_value, index) => index === axis ? 1 : 0)
}

/** Install one Ollama-compatible batch endpoint and retain every requested input. */
function stubEmbeddings(selectAxis: (input: string) => number): string[][] {
  const requests: string[][] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new TypeError('expected a serialized Ollama request body')
    const body = JSON.parse(init.body) as { input: string[]; model: string; dimensions: number }
    requests.push(body.input)
    return new Response(JSON.stringify({
      model: body.model,
      embeddings: body.input.map(input => unitVector(selectAxis(input))),
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return requests
}

const alpha = { workspaceId: WorkspaceId('workspace-alpha') }
const beta = { workspaceId: WorkspaceId('workspace-beta') }
const source = { kind: 'session' as const, sessionId: SessionId('session-alpha') }

describe('local durable memory operations', () => {
  it('creates, searches accent-insensitively, corrects by revision, and forgets', async () => {
    const { ctx } = await harness()
    const created = await ctx.memory.create({
      scope: alpha,
      content: '  A preferência de implantação é usar Ollama local.  ',
      source,
      importance: 0.7,
      confidence: 1,
      validation: 'explicit',
    })

    expect(created).toMatchObject({
      content: 'A preferência de implantação é usar Ollama local.',
      revision: 1,
      importance: 0.7,
      confidence: 1,
      validation: 'explicit',
    })
    const hits = await ctx.memory.search({ scope: alpha, query: 'preferencia ollama', limit: 8 })
    expect(hits).toMatchObject([{ record: { id: created.id, revision: 1 } }])
    expect(typeof hits[0]?.score).toBe('number')

    const corrected = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'A preferência de implantação é usar Ollama local com fallback remoto.',
    })
    expect(corrected).toMatchObject({
      id: created.id,
      revision: 2,
      importance: 0.7,
      confidence: 1,
      validation: 'explicit',
    })
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'correção obsoleta',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_REVISION_CONFLICT' }))

    await ctx.memory.forget({ scope: alpha, ref: { id: created.id, revision: 2 } })
    await expect(ctx.memory.search({ scope: alpha, query: 'ollama', limit: 8 })).resolves.toEqual([])
    await expect(ctx.memory.forget({ scope: alpha, ref: { id: created.id, revision: 2 } }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))
    await ctx.fiber.dispose()
  })

  it('normalizes legacy durable records missing schemaVersion', async () => {
    const pool = new MemoryMediaPool()
    const legacyId = MemoryId('legacy-without-schema')
    const media = pool.media.get('memory_local')
      ?? { tables: new Map<string, Map<string, unknown>>(), global: null }
    const memories = media.tables.get('memories') ?? new Map<string, unknown>()
    memories.set(legacyId, {
      workspaceId: String(alpha.workspaceId),
      content: 'Projeto Leon usa memória legado em português.',
      revision: 1,
      source: { kind: 'session', sessionId: String(source.sessionId) },
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
    })
    media.tables.set('memories', memories)
    pool.media.set('memory_local', media)

    const { ctx } = await harness(pool)
    const hits = await ctx.memory.search({
      scope: alpha,
      query: 'Leon legado',
      limit: 8,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      record: {
        id: legacyId,
        schemaVersion: 1,
        revision: 1,
      },
    })
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: legacyId, revision: 1 },
      content: 'Projeto Leon atualizou a memória legado em português.',
    })).resolves.toMatchObject({ revision: 2, supersedes: { id: legacyId, revision: 1 } })
    await ctx.fiber.dispose()
  })

  it('preserves contradictory revisions atomically and returns history only on demand', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx, pool } = await harness()
    const created = await ctx.memory.create({
      scope: alpha,
      content: 'O painel Leon usa a porta 3080.',
      source,
    })
    vi.setSystemTime(new Date('2026-08-25T13:00:00.000Z'))
    const updateSource = { kind: 'session' as const, sessionId: SessionId('session-correction') }
    const corrected = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'O painel Leon usa a porta 4175.',
      source: updateSource,
    })

    expect(corrected).toMatchObject({
      id: created.id,
      revision: 2,
      schemaVersion: 2,
      source: updateSource,
      validFrom: '2026-08-25T13:00:00.000Z',
      supersedes: { id: created.id, revision: 1 },
    })
    await expect(ctx.memory.search({ scope: alpha, query: 'painel Leon porta', limit: 8 }))
      .resolves.toMatchObject([{ record: { revision: 2, content: 'O painel Leon usa a porta 4175.' } }])
    const history = await ctx.memory.search({
      scope: alpha,
      query: 'painel Leon porta',
      limit: 8,
      includeHistory: true,
    })
    expect(history.map(hit => hit.record.revision)).toEqual([2, 1])
    expect(history[1]).toMatchObject({ record: {
      id: created.id,
      revision: 1,
      content: 'O painel Leon usa a porta 3080.',
      validUntil: '2026-08-25T13:00:00.000Z',
      supersededBy: { id: created.id, revision: 2 },
    } })
    const stored = pool.media.get('memory_local')?.tables.get('memories')?.get(String(created.id)) as {
      history?: unknown[]
    }
    expect(stored.history).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('hides scheduled and expired records from active search while retaining audit history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx } = await harness()
    const created = await ctx.memory.create({
      scope: alpha,
      content: 'A janela temporária do Leon está ativa.',
      source,
      validFrom: '2026-08-25T13:00:00.000Z',
      expiresAt: '2026-08-25T14:00:00.000Z',
    })

    await expect(ctx.memory.search({ scope: alpha, query: 'janela temporaria', limit: 8 })).resolves.toEqual([])
    vi.setSystemTime(new Date('2026-08-25T13:30:00.000Z'))
    await expect(ctx.memory.search({ scope: alpha, query: 'janela temporaria', limit: 8 }))
      .resolves.toMatchObject([{ record: {
        id: created.id,
        validFrom: '2026-08-25T13:00:00.000Z',
        expiresAt: '2026-08-25T14:00:00.000Z',
      } }])
    vi.setSystemTime(new Date('2026-08-25T14:00:00.000Z'))
    await expect(ctx.memory.search({ scope: alpha, query: 'janela temporaria', limit: 8 })).resolves.toEqual([])
    await expect(ctx.memory.search({
      scope: alpha,
      query: 'janela temporaria',
      limit: 8,
      includeHistory: true,
    })).resolves.toMatchObject([{ record: { id: created.id, revision: 1 } }])
    await ctx.fiber.dispose()
  })

  it('inherits a future expiry and can explicitly clear it in a later preserved revision', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx } = await harness()
    const created = await ctx.memory.create({
      scope: alpha,
      content: 'Política temporal inicial.',
      source,
      importance: 0.8,
      confidence: 0.9,
      validation: 'reviewed',
      expiresAt: '2026-08-25T15:00:00.000Z',
    })
    vi.setSystemTime(new Date('2026-08-25T13:00:00.000Z'))
    const second = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'Política temporal corrigida.',
    })
    expect(second).toMatchObject({
      revision: 2,
      source,
      importance: 0.8,
      confidence: 0.9,
      validation: 'reviewed',
      expiresAt: '2026-08-25T15:00:00.000Z',
    })
    vi.setSystemTime(new Date('2026-08-25T13:00:00.000Z'))
    const third = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 2 },
      content: 'Política temporal sem expiração.',
      expiresAt: null,
    })

    expect(third).toMatchObject({ revision: 3, supersedes: { id: created.id, revision: 2 } })
    expect(third).not.toHaveProperty('expiresAt')
    const history = await ctx.memory.search({
      scope: alpha,
      query: 'politica temporal',
      limit: 8,
      includeHistory: true,
    })
    expect(history.map(hit => hit.record.revision)).toEqual([3, 2, 1])
    expect(history[1]?.record).toMatchObject({
      expiresAt: '2026-08-25T15:00:00.000Z',
      supersedes: { id: created.id, revision: 1 },
      supersededBy: { id: created.id, revision: 3 },
    })
    await ctx.fiber.dispose()
  })

  it('keeps the prior revision active until a scheduled correction becomes valid', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx } = await harness()
    const created = await ctx.memory.create({
      scope: alpha,
      content: 'A janela de manutenção começa hoje.',
      source,
    })
    const scheduled = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'A janela de manutenção começa amanhã.',
      validFrom: '2026-08-26T12:00:00.000Z',
    })

    await expect(ctx.memory.search({ scope: alpha, query: 'janela manutencao', limit: 8 }))
      .resolves.toMatchObject([{ record: { revision: 1, content: 'A janela de manutenção começa hoje.' } }])
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    await expect(ctx.memory.search({ scope: alpha, query: 'janela manutencao', limit: 8 }))
      .resolves.toMatchObject([{ record: {
        revision: 2,
        content: 'A janela de manutenção começa amanhã.',
        validFrom: scheduled.validFrom,
      } }])
    await ctx.fiber.dispose()
  })

  it('filters malformed or inactive temporal rows even when legacy media contains them', async () => {
    const pool = new MemoryMediaPool()
    const media = { tables: new Map<string, Map<string, unknown>>(), global: null }
    const memories = new Map<string, unknown>()
    const base = {
      workspaceId: String(alpha.workspaceId),
      content: 'Estado temporal auditável.',
      revision: 1,
      source: { kind: 'session', sessionId: String(source.sessionId) },
      schemaVersion: 2,
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:00:00.000Z',
    }
    memories.set('invalid-date', { ...base, validFrom: 'not-a-date' })
    memories.set('invalid-validity-order', {
      ...base,
      validFrom: '2026-08-25T12:00:00.000Z',
      validUntil: '2026-08-25T11:00:00.000Z',
    })
    memories.set('invalid-expiry-order', {
      ...base,
      validFrom: '2026-08-25T12:00:00.000Z',
      expiresAt: '2026-08-25T12:00:00.000Z',
    })
    memories.set('ended-current', {
      ...base,
      validFrom: '2026-08-25T10:00:00.000Z',
      validUntil: '2026-08-25T11:00:00.000Z',
    })
    memories.set('superseded-current', {
      ...base,
      supersededBy: { id: 'superseded-current', revision: 2 },
    })
    memories.set('invalid-ref', { ...base, supersedes: { id: '', revision: 1 } })
    media.tables.set('memories', memories)
    pool.media.set('memory_local', media)
    const { ctx } = await harness(pool)

    await expect(ctx.memory.search({ scope: alpha, query: 'estado temporal', limit: 8 })).resolves.toEqual([])
    const history = await ctx.memory.search({
      scope: alpha,
      query: 'estado temporal',
      limit: 8,
      includeHistory: true,
    })
    expect(history.map(hit => hit.record.id).sort()).toEqual([
      MemoryId('ended-current'),
      MemoryId('superseded-current'),
    ].sort())
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: MemoryId('ended-current'), revision: 1 },
      content: 'Estado temporal recuperado.',
    })).resolves.toMatchObject({ revision: 2 })
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: MemoryId('superseded-current'), revision: 1 },
      content: 'Estado substituído recuperado.',
    })).resolves.toMatchObject({ revision: 2 })
    await ctx.fiber.dispose()
  })

  it('rejects an expiry that is already behind the provider-owned activation time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx } = await harness()

    await expect(ctx.memory.create({
      scope: alpha,
      content: 'Expiração passada.',
      source,
      expiresAt: '2026-08-25T11:00:00.000Z',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_TEMPORAL' }))
    await ctx.fiber.dispose()
  })

  it('supports a v1 rollback mode that overwrites without adding temporal history', async () => {
    const { ctx, pool } = await harness(new MemoryMediaPool(), { historyMode: 'v1' })
    const created = await ctx.memory.create({ scope: alpha, content: 'Valor antigo do rollback.', source })
    const corrected = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'Valor atual do rollback.',
    })

    expect(corrected).toMatchObject({ id: created.id, revision: 2 })
    expect(corrected).not.toHaveProperty('supersedes')
    await expect(ctx.memory.search({
      scope: alpha,
      query: 'rollback',
      limit: 8,
      includeHistory: true,
    })).resolves.toMatchObject([{ record: { revision: 2, content: 'Valor atual do rollback.' } }])
    const stored = pool.media.get('memory_local')?.tables.get('memories')?.get(String(created.id)) as {
      history?: unknown[]
    }
    expect(stored.history).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps active temporal safety for existing V2 values while v1 write rollback is enabled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const pool = new MemoryMediaPool()
    const temporal = await harness(pool)
    const created = await temporal.ctx.memory.create({
      scope: alpha,
      content: 'Compatibilidade temporal no rollback.',
      source,
      expiresAt: '2026-08-25T13:00:00.000Z',
    })
    await temporal.ctx.fiber.dispose()
    pool.media.get('memory_local')?.tables.get('memories')?.set(MemoryId('malformed-v2'), {
      workspaceId: String(alpha.workspaceId),
      content: 'Registro V2 temporalmente inválido.',
      revision: 1,
      source: { kind: 'session', sessionId: String(source.sessionId) },
      schemaVersion: 2,
      validFrom: 'not-a-date',
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    })

    vi.setSystemTime(new Date('2026-08-25T14:00:00.000Z'))
    const rollback = await harness(pool, { historyMode: 'v1' })
    await expect(rollback.ctx.memory.search({ scope: alpha, query: 'compatibilidade temporal', limit: 8 }))
      .resolves.toEqual([])
    await expect(rollback.ctx.memory.search({
      scope: alpha,
      query: 'compatibilidade temporal',
      limit: 8,
      includeHistory: true,
    })).resolves.toMatchObject([{ record: { id: created.id, revision: 1 } }])
    await expect(rollback.ctx.memory.search({ scope: alpha, query: 'registro V2 invalido', limit: 8 }))
      .resolves.toEqual([])
    await rollback.ctx.fiber.dispose()
  })

  it('never returns or mutates a record through another workspace scope', async () => {
    const { ctx } = await harness()
    const created = await ctx.memory.create({ scope: alpha, content: 'Servidor usa a porta 3080.', source })

    await expect(ctx.memory.search({ scope: beta, query: 'porta 3080', limit: 8 })).resolves.toEqual([])
    await expect(ctx.memory.update({
      scope: beta,
      ref: { id: created.id, revision: 1 },
      content: 'Servidor usa outra porta.',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))
    await expect(ctx.memory.forget({ scope: beta, ref: { id: created.id, revision: 1 } }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))

    await expect(ctx.memory.search({ scope: alpha, query: 'porta 3080', limit: 8 }))
      .resolves.toMatchObject([{ record: { id: created.id, revision: 1 } }])
    await ctx.fiber.dispose()
  })

  it('emits blocked events for cross-scope mutation attempts', async () => {
    const { ctx } = await harness()
    const blocked: Array<{ reason: string; source: string; workspaceId: typeof alpha.workspaceId }> = []
    ctx.on('memory/blocked', event => blocked.push({
      reason: event.reason,
      source: event.source,
      workspaceId: event.workspaceId,
    }))

    const created = await ctx.memory.create({ scope: alpha, content: 'Servidor usa a porta 3080.', source })
    await expect(ctx.memory.update({
      scope: beta,
      ref: { id: created.id, revision: 1 },
      content: 'Tentativa bloqueada.',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))
    await expect(ctx.memory.forget({
      scope: beta,
      ref: { id: created.id, revision: 1 },
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))

    expect(blocked).toHaveLength(2)
    for (const event of blocked) {
      expect(event.reason).toBe('cross-scope-write')
      expect(event.source).toBe('memory-local')
      expect(event.workspaceId).toBe(beta.workspaceId)
    }
    await ctx.fiber.dispose()
  })

  it('reopens the same durable records after the provider lifecycle restarts', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const created = await first.ctx.memory.create({ scope: alpha, content: 'Leon fala português brasileiro.', source })
    await first.ctx.fiber.dispose()

    const second = await harness(pool)
    await expect(second.ctx.memory.search({ scope: alpha, query: 'portugues brasileiro', limit: 8 }))
      .resolves.toMatchObject([{ record: { id: created.id, content: 'Leon fala português brasileiro.' } }])
    await second.ctx.fiber.dispose()
  })

  it('does not publish a record when the durable write fails', async () => {
    const { ctx, pool } = await harness()
    pool.failNextWrites = 1
    await expect(ctx.memory.create({ scope: alpha, content: 'não deve aparecer', source }))
      .rejects.toThrow('injected write failure')
    await expect(ctx.memory.search({ scope: alpha, query: 'aparecer', limit: 8 })).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('propagates a non-domain durable failure while preserving the current revision', async () => {
    const { ctx, pool } = await harness()
    const created = await ctx.memory.create({ scope: alpha, content: 'revisão original', source })
    pool.failNextWrites = 1

    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'revisão que não deve persistir',
    })).rejects.toThrow('injected write failure')
    await expect(ctx.memory.search({ scope: alpha, query: 'original', limit: 8 }))
      .resolves.toMatchObject([{ record: { id: created.id, revision: 1 } }])
    const stored = pool.media.get('memory_local')?.tables.get('memories')?.get(String(created.id)) as {
      history?: unknown[]
    }
    expect(stored.history).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('handles punctuation-only lexical queries and deterministically breaks exact score and timestamp ties', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const { ctx } = await harness()
    const first = await ctx.memory.create({ scope: alpha, content: 'Marcador !!! repetido.', source })
    const second = await ctx.memory.create({ scope: alpha, content: 'Marcador !!! repetido.', source })

    const hits = await ctx.memory.search({ scope: alpha, query: '!!!', limit: 8 })

    expect(hits.map(hit => hit.record.id)).toEqual([first.id, second.id].sort())
    await ctx.fiber.dispose()
  })

  it('recalls a same-meaning memory with different words through the optional local semantic index', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const requests = stubEmbeddings(input => input.includes('Snapshots') || input.includes('cópias') ? 0 : 1)
    const { ctx } = await harness(new MemoryMediaPool(), {
      semanticSearch: { enabled: true, dimensions: 64, minimumScore: 0.5 },
    })
    const semanticEvents: Array<{
      mode: string
      candidateCount: number
      embeddedCount: number
      cacheHitCount: number
    }> = []
    ctx.on('memory/semantic-search', event => semanticEvents.push(event))
    await ctx.memory.create({ scope: alpha, content: 'Snapshots vault volume E.', source })
    await ctx.memory.create({ scope: alpha, content: 'Faturas vencem mensalmente.', source })

    const first = await ctx.memory.search({
      scope: alpha,
      query: 'Onde estão as cópias de segurança?',
      limit: 1,
    })
    const second = await ctx.memory.search({
      scope: alpha,
      query: 'Local das cópias protegidas?',
      limit: 1,
    })

    expect(first[0]?.record.content).toBe('Snapshots vault volume E.')
    expect(second[0]?.record.content).toBe('Snapshots vault volume E.')
    expect(requests).toHaveLength(2)
    expect(requests[0]).toHaveLength(3)
    expect(requests[1]).toHaveLength(1)
    expect(semanticEvents).toMatchObject([
      { mode: 'hybrid', candidateCount: 2, embeddedCount: 2, cacheHitCount: 0 },
      { mode: 'hybrid', candidateCount: 2, embeddedCount: 0, cacheHitCount: 2 },
    ])
    await ctx.fiber.dispose()
  })

  it('never sends another workspace memory to the semantic endpoint and reindexes a corrected revision', async () => {
    const requests = stubEmbeddings(() => 0)
    const { ctx } = await harness(new MemoryMediaPool(), {
      semanticSearch: { enabled: true, dimensions: 64 },
    })
    const visible = await ctx.memory.create({ scope: alpha, content: 'Conteúdo permitido alpha.', source })
    await ctx.memory.create({ scope: beta, content: 'SEGREDO DO WORKSPACE BETA.', source })

    await ctx.memory.search({ scope: alpha, query: 'consulta inicial', limit: 8 })
    await ctx.memory.update({
      scope: alpha,
      ref: { id: visible.id, revision: 1 },
      content: 'Conteúdo corrigido alpha.',
    })
    await ctx.memory.search({ scope: alpha, query: 'consulta posterior', limit: 8 })

    expect(JSON.stringify(requests)).not.toContain('SEGREDO DO WORKSPACE BETA')
    expect(requests[0]).toEqual(expect.arrayContaining([
      'search_query: consulta inicial',
      'search_document: Conteúdo permitido alpha.',
    ]))
    expect(requests[1]).toEqual(expect.arrayContaining([
      'search_query: consulta posterior',
      'search_document: Conteúdo corrigido alpha.',
    ]))
    await ctx.fiber.dispose()
  })

  it('falls back to lexical recall with sanitized telemetry when Ollama is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connect ECONNREFUSED secret-detail'))))
    const { ctx } = await harness(new MemoryMediaPool(), {
      semanticSearch: { enabled: true, dimensions: 64 },
    })
    const events: unknown[] = []
    ctx.on('memory/semantic-search', event => events.push(event))
    await ctx.memory.create({ scope: alpha, content: 'Servidor local usa a porta 3080.', source })

    await expect(ctx.memory.search({ scope: alpha, query: 'porta 3080', limit: 8 }))
      .resolves.toMatchObject([{ record: { content: 'Servidor local usa a porta 3080.' } }])
    expect(events).toMatchObject([{
      mode: 'lexical-fallback',
      fallbackCode: 'TRANSPORT',
      candidateCount: 1,
    }])
    expect(JSON.stringify(events)).not.toContain('porta 3080')
    expect(JSON.stringify(events)).not.toContain('secret-detail')
    await ctx.fiber.dispose()
  })

  it('keeps an exact lexical hit even when it is outside the bounded semantic candidate window', async () => {
    vi.useFakeTimers()
    const requests = stubEmbeddings(input => input.includes('search_query:') ? 0 : 1)
    const { ctx } = await harness(new MemoryMediaPool(), {
      semanticSearch: {
        enabled: true,
        dimensions: 64,
        maxCandidates: 1,
        minimumScore: 0.9,
      },
    })
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'))
    const lexical = await ctx.memory.create({ scope: alpha, content: 'código exato ALFA-42', source })
    vi.setSystemTime(new Date('2026-08-25T12:00:01.000Z'))
    await ctx.memory.create({ scope: alpha, content: 'registro recente sem relação', source })

    const hits = await ctx.memory.search({ scope: alpha, query: 'ALFA-42', limit: 8 })

    expect(hits[0]?.record.id).toBe(lexical.id)
    expect(requests[0]).toHaveLength(2)
    expect(requests[0]?.join('\n')).not.toContain('código exato ALFA-42')
    await ctx.fiber.dispose()
  })

  it('accepts a fully customized disabled semantic configuration including IPv6 loopback', async () => {
    const { ctx } = await harness(new MemoryMediaPool(), {
      semanticSearch: {
        enabled: false,
        baseUrl: 'http://[::1]:11434',
        model: ' custom-model ',
        dimensions: 64,
        timeoutMs: 1,
        maxCandidates: 1,
        maxCacheEntries: 1,
        maxResponseBytes: 1,
        minimumScore: 0,
        semanticWeight: 0,
        lexicalWeight: 1,
      },
    })
    await ctx.fiber.dispose()
  })

  it('resolves safe defaults when the provider apply function is used directly', async () => {
    const { ctx } = await harness(new MemoryMediaPool(), {}, true)
    await ctx.fiber.dispose()
  })

  it.each([
    ['empty model', { model: '   ' }],
    ['oversized model', { model: 'x'.repeat(257) }],
    ['non-integer dimensions', { dimensions: 64.5 }],
    ['dimensions below range', { dimensions: 63 }],
    ['dimensions above range', { dimensions: 769 }],
    ['timeout below range', { timeoutMs: 0 }],
    ['candidate limit above range', { maxCandidates: 10_001 }],
    ['cache limit below range', { maxCacheEntries: 0 }],
    ['response limit above range', { maxResponseBytes: 100_000_001 }],
    ['non-finite score', { minimumScore: Number.NaN }],
    ['score below range', { minimumScore: -0.1 }],
    ['score above range', { minimumScore: 1.1 }],
    ['non-finite semantic weight', { semanticWeight: Number.NaN }],
    ['negative semantic weight', { semanticWeight: -1 }],
    ['non-finite lexical weight', { lexicalWeight: Number.NaN }],
    ['negative lexical weight', { lexicalWeight: -1 }],
    ['zero combined weights', { semanticWeight: 0, lexicalWeight: 0 }],
  ] satisfies Array<[string, MemoryLocal.SemanticSearchConfig]>)('rejects invalid semantic config: %s', async (_name, invalid) => {
    await expect(harness(new MemoryMediaPool(), { semanticSearch: invalid }))
      .rejects.toThrow('memory-local: semantic')
  })

  it.each([
    'not a URL',
    'https://127.0.0.1:11434',
    'http://localhost:11434',
    'http://user@127.0.0.1:11434',
    'http://:secret@127.0.0.1:11434',
    'http://127.0.0.1:11434/api',
    'http://127.0.0.1:11434?query=1',
    'http://127.0.0.1:11434#fragment',
  ])('rejects a non-origin or non-loopback semantic endpoint: %s', async (baseUrl) => {
    await expect(harness(new MemoryMediaPool(), { semanticSearch: { baseUrl } }))
      .rejects.toThrow('memory-local: semantic baseUrl must be an absolute loopback HTTP origin')
  })

  it('rejects cancellation and invalid bounds before mutation or provider execution', async () => {
    const { ctx } = await harness()
    const abort = new AbortController()
    abort.abort(new Error('cancelled by test'))
    await expect(ctx.memory.create({ scope: alpha, content: 'cancelled', source }, abort.signal))
      .rejects.toThrow('cancelled by test')
    const plainAbort = new AbortController()
    plainAbort.abort('plain reason')
    await expect(ctx.memory.create({ scope: alpha, content: 'also cancelled', source }, plainAbort.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_ABORTED' }))
    await expect(ctx.memory.search({ scope: alpha, query: '', limit: 8 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_QUERY' }))
    await expect(ctx.memory.search({ scope: alpha, query: 'valid', limit: 51 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_LIMIT' }))
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: MemoryId('missing'), revision: 0 },
      content: 'invalid',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_REVISION' }))
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: MemoryId('missing-valid-revision'), revision: 1 },
      content: 'missing',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }))
    await ctx.fiber.dispose()
  })
})
