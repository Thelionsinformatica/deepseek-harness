import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime, { MemoryId } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** Mount the real memory seam and local provider over a controllable durable medium. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(MemoryRuntime, { provider: 'local' })
  await ctx.plugin(MemoryLocal)
  return { ctx, pool }
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
    })

    expect(created).toMatchObject({ content: 'A preferência de implantação é usar Ollama local.', revision: 1 })
    const hits = await ctx.memory.search({ scope: alpha, query: 'preferencia ollama', limit: 8 })
    expect(hits).toMatchObject([{ record: { id: created.id, revision: 1 } }])
    expect(typeof hits[0]?.score).toBe('number')

    const corrected = await ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'A preferência de implantação é usar Ollama local com fallback remoto.',
    })
    expect(corrected).toMatchObject({ id: created.id, revision: 2 })
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
    await ctx.fiber.dispose()
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

  it('rejects cancellation and invalid bounds before mutation or provider execution', async () => {
    const { ctx } = await harness()
    const abort = new AbortController()
    abort.abort(new Error('cancelled by test'))
    await expect(ctx.memory.create({ scope: alpha, content: 'cancelled', source }, abort.signal))
      .rejects.toThrow('cancelled by test')
    await expect(ctx.memory.search({ scope: alpha, query: '', limit: 8 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_QUERY' }))
    await expect(ctx.memory.search({ scope: alpha, query: 'valid', limit: 51 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_LIMIT' }))
    await expect(ctx.memory.update({
      scope: alpha,
      ref: { id: MemoryId('missing'), revision: 0 },
      content: 'invalid',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_REVISION' }))
    await ctx.fiber.dispose()
  })
})
