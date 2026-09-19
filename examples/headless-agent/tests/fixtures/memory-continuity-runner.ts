import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import * as continuityPlugin from '@deepseek-ai/dsh-memory-continuity'
import { MemoryContinuityTable, localMemoryRecord, parseSnapshot, serializeSnapshot } from '@deepseek-ai/dsh-memory-continuity'

const config = process.argv[2]
assert.equal('default' in continuityPlugin, false, 'Function plugins must preserve namespace exports')
if (config === undefined) throw new Error('Missing composition path')
const ctx = await boot('memory-continuity-snapshot', config)
try {
  const provider = ctx.get('memoryContinuity')
  assert.ok(provider, 'Loader must register memory continuity')
  const record = localMemoryRecord.parse({
    workspaceId: 'fixture-workspace', content: 'Use local memory', revision: 1,
    source: { kind: 'session', sessionId: 'fixture-session' },
    createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
  })
  const id = MemoryId('fixture-memory')
  const full = provider.export([{ name: 'memory_local', version: 1, table: 'memories', records: [[id, record]] }])
  await writeFile('memory-snapshot.json', serializeSnapshot(full))
  const restored = parseSnapshot(await readFile('memory-snapshot.json', 'utf8'))
  const table = new MemoryContinuityTable()
  await assert.rejects(provider.import(restored, []), /not registered/)
  assert.equal(table.size, 0)
  const targets = [{ name: 'memory_local', version: 1, table }]
  const first = await provider.import(restored, targets)
  const again = await provider.import(restored, targets)
  assert.equal(table.get(id)?.content, record.content)
  process.stdout.write(JSON.stringify({ imported: first.imported, skipped: again.skippedExisting, count: table.size }) + '\n')
} finally {
  await ctx.fiber.dispose()
}
assert.equal(ctx.get('memoryContinuity'), undefined, 'Disposal must remove the service')
