import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import PersonalMemoryRuntime, { PersonalMemoryOwnerId } from '@deepseek-ai/dsh-personal-memory'
import * as PersonalMemoryLocal from '@deepseek-ai/dsh-personal-memory-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PersonalMemoryRuntime, { provider: 'local' })
  await ctx.plugin(PersonalMemoryLocal)
  return { ctx, pool }
}

const owner = { ownerId: PersonalMemoryOwnerId('leon-owner') }
const other = { ownerId: PersonalMemoryOwnerId('other-owner') }
const source = { kind: 'session' as const, sessionId: SessionId('personal-local-source') }

describe('local personal-memory provider', () => {
  it('persists, recalls, corrects, and forgets across sessions', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const created = await first.ctx.personalMemory.create({
      scope: owner,
      content: 'O usuário prefere comunicação em português do Brasil.',
      source,
      validation: 'explicit',
    })
    await first.ctx.fiber.dispose()

    const second = await harness(pool)
    await expect(second.ctx.personalMemory.search({
      scope: owner,
      query: 'comunicacao portugues',
      limit: 8,
    })).resolves.toMatchObject([{ record: { id: created.id, revision: 1 } }])
    const corrected = await second.ctx.personalMemory.update({
      scope: owner,
      ref: { id: created.id, revision: 1 },
      content: 'O usuário prefere comunicação direta em português do Brasil.',
      source,
    })
    expect(corrected).toMatchObject({ revision: 2, supersedes: { id: created.id, revision: 1 } })
    await second.ctx.personalMemory.forget({ scope: owner, ref: { id: created.id, revision: 2 } })
    await expect(second.ctx.personalMemory.search({ scope: owner, query: 'portugues', limit: 8 }))
      .resolves.toEqual([])
    await second.ctx.fiber.dispose()
  })

  it('isolates owners and uses a domain distinct from workspace memory', async () => {
    const { ctx, pool } = await harness()
    const created = await ctx.personalMemory.create({
      scope: owner,
      content: 'O dispositivo recorrente é uma estação Windows.',
      source,
    })
    await expect(ctx.personalMemory.search({ scope: other, query: 'estacao Windows', limit: 8 }))
      .resolves.toEqual([])
    await expect(ctx.personalMemory.update({
      scope: other,
      ref: { id: created.id, revision: 1 },
      content: 'Tentativa de cruzar o proprietário.',
    })).rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_NOT_FOUND' }))
    expect(pool.media.has('personal_memory_local')).toBe(true)
    expect(pool.media.has('memory_local')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('retains revision history for explicit local audit', async () => {
    const { ctx } = await harness()
    const created = await ctx.personalMemory.create({ scope: owner, content: 'Alias do servidor: alfa.', source })
    await ctx.personalMemory.update({
      scope: owner,
      ref: { id: created.id, revision: 1 },
      content: 'Alias do servidor: beta.',
    })
    const page = await ctx.personalMemory.list({ scope: owner, limit: 20 })
    expect(page.items.map(item => item.record.revision).sort()).toEqual([1, 2])
    await expect(ctx.personalMemory.forget({
      scope: owner,
      ref: { id: MemoryId(String(created.id)), revision: 1 },
    })).rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_REVISION_CONFLICT' }))
    await ctx.fiber.dispose()
  })
})
