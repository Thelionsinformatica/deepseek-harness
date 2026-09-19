import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { localMemoryRecord } from '@deepseek-ai/dsh-memory-continuity'

const [config, stage, mode] = process.argv.slice(2)
assert.ok(config)
assert.ok(stage === 'partial-temp' || stage === 'before-rename' || stage === 'after-rename')
const root = process.env.LEON_MEMORY_TEST_ROOT
assert.ok(root)
const target = join(root, 'restart_original.json')
const ctx = await boot('memory-write-interruption', config)
try {
  const facility = ctx.get('storageDomain')
  assert.ok(facility)
  const domain = await facility.open(defineDomain({
    name: 'restart_original', version: 1,
    tables: { memories: domainTable<ReturnType<typeof MemoryId>, ReturnType<typeof localMemoryRecord.parse>>(localMemoryRecord) },
  }))
  const table = domain.table('memories')
  const id = MemoryId('restart-record')
  const current = table.get(id)
  assert.ok(current)
  if (mode === 'verify') {
    assert.equal(current.revision, stage === 'after-rename' ? 3 : 2)
    assert.equal(current.content, stage === 'after-rename' ? 'New committed decision' : 'Confirmed decision')
    assert.equal(table.size, 1)
  } else {
    assert.equal(current.revision, 2)
    const open = fs.open
    const rename = fs.rename
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args)
      const path = String(args[0])
      if (stage === 'partial-temp' && dirname(path) === root && basename(path).endsWith('.tmp')) {
        handle.writeFile = async (data) => {
          assert.equal(typeof data, 'string')
          await handle.write(String(data).slice(0, Math.floor(String(data).length / 2)))
          await handle.sync()
          process.exit(74)
        }
      }
      return handle
    }
    fs.rename = async (from, to) => {
      if (String(to) === target && stage === 'before-rename') process.exit(75)
      await rename(from, to)
      if (String(to) === target && stage === 'after-rename') process.exit(76)
    }
    syncBuiltinESMExports()
    await table.put(id, { ...current, revision: 3, content: 'New committed decision' })
    throw new Error('Fault injection point was not reached')
  }
} finally {
  await ctx.fiber.dispose()
}
