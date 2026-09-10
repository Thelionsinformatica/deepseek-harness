import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime, { MemoryId } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import {
  MemoryContinuityProvider,
  MemoryContinuityTable,
  exportJournal,
  parseSnapshot,
  serializeSnapshot,
} from '@deepseek-ai/dsh-memory-continuity'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(MemoryRuntime, { provider: 'local' })
  await ctx.plugin(MemoryLocal, {})
  return { ctx, pool }
}

function domainFromPool(pool: MemoryMediaPool) {
  const medium = pool.media.get('memory_local')
  const records = medium?.tables.get('memories') ?? new Map<string, unknown>()
  return {
    name: 'memory_local',
    version: 1,
    table: 'memories',
    records: [...records.entries()].map(([id, record]) => [MemoryId(id), MemoryLocal.localMemoryRecord.parse(record)] as const),
  }
}

const alpha = { workspaceId: WorkspaceId('workspace-alpha') }
const source = { kind: 'session' as const, sessionId: SessionId('session-alpha') }

describe('memory continuity', () => {
  it('rejects adapter callback failures without committing a record', async () => {
    const table = new MemoryContinuityTable()
    const id = MemoryId('failed-mutation')
    const updating = table.update(id, current => current)
    await expect(updating).rejects.toThrow('was not found')
    const mutating = table.mutate(id, () => { throw new Error('callback failed') })
    await expect(mutating).rejects.toThrow('callback failed')
    expect(table.size).toBe(0)
  })

  it('does not write when a later domain has no target', async () => {
    const { ctx, pool } = await harness()
    try {
      const created = await ctx.memory.create({
        scope: alpha, content: 'Restore probe', source, importance: 0.8, confidence: 1,
      })
      const provider = new MemoryContinuityProvider()
      const first = domainFromPool(pool)
      const snapshot = provider.export([first, { ...first, name: 'missing_target' }])
      const table = new MemoryContinuityTable()
      await expect(provider.import(snapshot, [{ name: first.name, version: first.version, table }]))
        .rejects.toThrow("target 'missing_target' is not registered")
      expect(table.get(created.id)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['version', 'duplicate-target', 'duplicate-domain', 'duplicate-record'])('rejects %s before writing', async (fault) => {
    const { ctx, pool } = await harness()
    try {
      await ctx.memory.create({ scope: alpha, content: 'Preflight probe', source, importance: 0.8, confidence: 1 })
      const provider = new MemoryContinuityProvider()
      const first = domainFromPool(pool)
      const second = { ...first, name: fault === 'duplicate-domain' ? first.name : 'second' }
      if (fault === 'duplicate-record') second.records = [...second.records, ...second.records]
      const snapshot = provider.export([first, second])
      const table = new MemoryContinuityTable()
      const targets = [
        { name: first.name, version: 1, table },
        { name: 'second', version: fault === 'version' ? 2 : 1, table: new MemoryContinuityTable() },
      ]
      if (fault === 'duplicate-target') targets.push(targets[0]!)
      await expect(provider.import(snapshot, targets)).rejects.toThrow()
      expect(table.size).toBe(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports storage failure and resumes without duplicating committed records', async () => {
    const { ctx, pool } = await harness()
    try {
      await ctx.memory.create({ scope: alpha, content: 'Recovery probe', source, importance: 0.8, confidence: 1 })
      const provider = new MemoryContinuityProvider()
      const first = domainFromPool(pool)
      const snapshot = provider.export([first, { ...first, name: 'second' }])
      const table = new MemoryContinuityTable()
      const second = new MemoryContinuityTable()
      const targets = [{ name: first.name, version: 1, table }, { name: 'second', version: 1, table: second }]
      vi.spyOn(second, 'mutate').mockRejectedValueOnce(new Error('disk failure'))
      await expect(provider.import(snapshot, targets)).rejects.toThrow('Memory import incomplete')
      expect(table.size).toBe(1)
      expect(second.size).toBe(0)
      expect(await provider.import(snapshot, targets)).toMatchObject({ imported: 1, skippedExisting: 1 })
      expect(table.size).toBe(1)
      expect(second.size).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses atomic conditional insertion for concurrent imports', async () => {
    const { ctx, pool } = await harness()
    try {
      await ctx.memory.create({ scope: alpha, content: 'Concurrent probe', source, importance: 0.8, confidence: 1 })
      const provider = new MemoryContinuityProvider()
      const snapshot = provider.export([domainFromPool(pool)])
      const table = new MemoryContinuityTable()
      const mutate = vi.spyOn(table, 'mutate')
      const put = vi.spyOn(table, 'put')
      const targets = [{ name: 'memory_local', version: 1, table }]
      const results = await Promise.all([provider.import(snapshot, targets), provider.import(snapshot, targets)])
      expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(1)
      expect(results.reduce((sum, result) => sum + result.skippedExisting, 0)).toBe(1)
      expect(table.size).toBe(1)
      expect(mutate).toHaveBeenCalledTimes(2)
      expect(put).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('exports, destroys, restores, and preserves searchable lineage idempotently', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const created = await first.ctx.memory.create({
      scope: alpha,
      content: 'A decisão original usa memória local.',
      source,
      importance: 0.8,
      confidence: 1,
    })
    const corrected = await first.ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'A decisão corrigida continua usando memória local.',
      source: { kind: 'session', sessionId: SessionId('session-correction') },
    })
    const continuity = new MemoryContinuityProvider()
    const snapshot = continuity.export([domainFromPool(pool)], { exportedAt: '2026-09-05T00:00:00.000Z' })
    const serialized = serializeSnapshot(snapshot)
    const journalEntry = exportJournal(snapshot, 'acceptance-test')
    await first.ctx.fiber.dispose()

    pool.media.delete('memory_local')

    const restoredTable = new MemoryContinuityTable()
    const parsed = parseSnapshot(serialized)
    const result = await continuity.import(parsed, [{
      name: 'memory_local',
      version: 1,
      table: restoredTable,
    }])
    const duplicate = await continuity.import(parsed, [{
      name: 'memory_local',
      version: 1,
      table: restoredTable,
    }])

    expect(journalEntry).toMatchObject({ operation: 'export', recordCount: 1, checksum: snapshot.checksum })
    expect(result).toMatchObject({ imported: 1, skippedExisting: 0 })
    expect(duplicate).toMatchObject({ imported: 0, skippedExisting: 1 })
    expect(restoredTable.get(created.id)).toMatchObject({
      revision: 2,
      content: corrected.content,
      supersedes: { id: created.id, revision: 1 },
    })
    expect(restoredTable.get(created.id)?.history).toHaveLength(1)
  })

  it('rejects tampered snapshots before touching the target', async () => {
    const provider = new MemoryContinuityProvider()
    const table = new MemoryContinuityTable()
    const tampered = {
      schemaVersion: 1,
      exportedAt: '2026-09-05T00:00:00.000Z',
      format: 'dsh-memory-continuity/json',
      domains: [],
      checksum: '0'.repeat(64),
    } as const
    await expect(provider.import(tampered as never, [{ name: 'memory_local', version: 1, table }]))
      .rejects.toThrow('checksum mismatch')
    expect([...table.entries()]).toEqual([])
  })

  it('survives provider restart and model switch with intact context and provenance', async () => {
    const pool = new MemoryMediaPool()
    const continuity = new MemoryContinuityProvider()

    // First lifecycle: create memory with "model A" (Ollama/qwen)
    const first = await harness(pool)
    const created = await first.ctx.memory.create({
      scope: alpha,
      content: 'Leon usa memória local com modelo Qwen.',
      source: { kind: 'session', sessionId: SessionId('session-qwen') },
      importance: 0.9,
      confidence: 1,
      validation: 'explicit',
    })
    await first.ctx.memory.update({
      scope: alpha,
      ref: { id: created.id, revision: 1 },
      content: 'Leon usa memória local com modelo Mistral.',
      source: { kind: 'session', sessionId: SessionId('session-mistral') },
    })
    await first.ctx.fiber.dispose()

    // Export before "model switch"
    const snapshot = continuity.export([domainFromPool(pool)])

    // Second lifecycle: reopen with same pool (simulates restart + model switch)
    const second = await harness(pool)
    const hits = await second.ctx.memory.search({
      scope: alpha,
      query: 'memória local Mistral',
      limit: 8,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.record).toMatchObject({
      id: created.id,
      revision: 2,
      content: 'Leon usa memória local com modelo Mistral.',
      importance: 0.9,
      confidence: 1,
      validation: 'explicit',
      source: { kind: 'session', sessionId: 'session-mistral' },
    })

    // Verify provenance chain survives
    const history = await second.ctx.memory.search({
      scope: alpha,
      query: 'memória local',
      limit: 8,
      includeHistory: true,
    })
    expect(history.map(h => h.record.revision)).toEqual([2, 1])
    expect(history[1]?.record).toMatchObject({
      content: 'Leon usa memória local com modelo Qwen.',
      source: { kind: 'session', sessionId: 'session-qwen' },
    })

    // Verify export after restart produces identical snapshot
    const secondSnapshot = continuity.export([domainFromPool(pool)])
    expect(secondSnapshot.checksum).toBe(snapshot.checksum)

    await second.ctx.fiber.dispose()
  })
})
