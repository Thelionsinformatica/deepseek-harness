import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { localMemoryRecord, parseSnapshot, serializeSnapshot } from '@deepseek-ai/dsh-memory-continuity'

const [config, phase] = process.argv.slice(2)
assert.ok(config)
assert.ok(phase === 'seed' || phase === 'seed-abrupt' || phase === 'restore' || phase === 'verify')
const root = process.env.LEON_MEMORY_TEST_ROOT || join(process.cwd(), 'store')
const ctx = await boot('memory-restart', config)
try {
  const facility = ctx.get('storageDomain')
  const continuity = ctx.get('memoryContinuity')
  assert.ok(facility)
  assert.ok(continuity)
  const original = await facility.open(defineDomain({
    name: 'restart_original', version: 1,
    tables: { memories: domainTable<ReturnType<typeof MemoryId>, ReturnType<typeof localMemoryRecord.parse>>(localMemoryRecord) },
  }))
  const table = original.table('memories')
  const id = MemoryId('restart-record')
  const timestamp = '2026-09-06T00:00:00Z'
  const previous = {
    content: 'Original decision', revision: 1, source: { kind: 'session', sessionId: 'restart-session' },
    createdAt: timestamp, updatedAt: timestamp,
  }
  const expected = localMemoryRecord.parse({
    ...previous, workspaceId: 'restart-workspace', content: 'Confirmed decision', revision: 2,
    history: [previous],
  })
  if (phase === 'seed' || phase === 'seed-abrupt') {
    assert.equal(table.size, 0)
    await table.put(id, expected)
    const snapshot = continuity.export([{
      name: 'restart_original', version: 1, table: 'memories', records: table.entries(),
    }])
    await writeFile(join(root, 'backup.json'), serializeSnapshot(snapshot), { flag: 'wx' })
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(JSON.stringify({ phase, count: table.size, revision: table.get(id)?.revision }) + '\n',
        (error) => {
          if (error) reject(error)
          else resolve()
        })
    })
    if (phase === 'seed-abrupt') process.exit(73)
  } else {
    assert.deepEqual(table.get(id), expected)
    const restored = await facility.open(defineDomain({
      name: 'restart_restored', version: 1,
      tables: { memories: domainTable<ReturnType<typeof MemoryId>, ReturnType<typeof localMemoryRecord.parse>>(localMemoryRecord) },
    }))
    const target = restored.table('memories')
    assert.equal(target.size, phase === 'restore' ? 0 : 1)
    const snapshot = parseSnapshot(await readFile(join(root, 'backup.json'), 'utf8'))
    const result = await continuity.import(snapshot, [{ name: 'restart_original', version: 1, table: target }])
    assert.deepEqual(target.get(id), expected)
    assert.equal(target.size, 1)
    assert.equal(result.imported, phase === 'restore' ? 1 : 0)
    assert.equal(result.skippedExisting, phase === 'verify' ? 1 : 0)
    process.stdout.write(JSON.stringify({
      phase, count: target.size, revision: target.get(id)?.revision,
      imported: result.imported, skipped: result.skippedExisting,
    }) + '\n')
  }
} finally {
  await ctx.fiber.dispose()
  if (phase === 'seed' || phase === 'seed-abrupt') {
    await writeFile(join(root, 'clean-shutdown.txt'), 'disposed', { flag: 'wx' })
  }
}
