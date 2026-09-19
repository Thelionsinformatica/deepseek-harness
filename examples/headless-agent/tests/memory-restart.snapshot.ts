import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it.each(['seed', 'seed-abrupt'])('preserves disk memory after %s and rejects corruption', async (seedPhase) => {
  const runner = fileURLToPath(new URL('./fixtures/memory-restart-runner.ts', import.meta.url))
  const configPath = fileURLToPath(new URL('../memory-restart.cordis.yml', import.meta.url))
  const options = {
    label: 'disk memory restart', tempDirPrefix: 'leon-memory-restart-',
    binScript: runner, libBinScript: runner, configPath, mode: 'lib' as const,
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  }
  const outputs: unknown[] = []
  const first = await runLoaderSmoke({
    ...options, binArgs: [configPath, seedPhase], env: { LEON_MEMORY_TEST_ROOT: '' },
    expectedExitCode: seedPhase === 'seed-abrupt' ? 73 : 0,
    async inspect(cwd) {
      const root = join(cwd, 'store')
      const shutdown = readFile(join(root, 'clean-shutdown.txt'), 'utf8')
      if (seedPhase === 'seed-abrupt') await expect(shutdown).rejects.toMatchObject({ code: 'ENOENT' })
      else expect(await shutdown).toBe('disposed')
      const original = await readFile(join(root, 'restart_original.json'), 'utf8')
      expect(original).toContain('Confirmed decision')
      expect(original).toContain('Original decision')
      for (const phase of ['restore', 'verify']) {
        const result = await runLoaderSmoke({
          ...options, binArgs: [configPath, phase], env: { LEON_MEMORY_TEST_ROOT: root },
        })
        outputs.push(JSON.parse(result.stdout))
        expect(await readFile(join(root, 'restart_original.json'), 'utf8')).toBe(original)
      }
      const restored = await readFile(join(root, 'restart_restored.json'), 'utf8')
      const sourceData = JSON.parse(original) as { tables: unknown; global: unknown }
      expect(JSON.parse(restored)).toEqual({
        unit: { name: 'restart_restored', version: 1 }, global: sourceData.global, tables: sourceData.tables,
      })
      await writeFile(join(root, 'restart_restored.json'), '{invalid-json')
      const rejected = await runLoaderSmoke({
        ...options, binArgs: [configPath, 'verify'], env: { LEON_MEMORY_TEST_ROOT: root }, expectedExitCode: 1,
      })
      expect(rejected.stderr).toContain("unit 'restart_restored': file is not valid JSON")
      expect(await readFile(join(root, 'restart_restored.json'), 'utf8')).toBe('{invalid-json')
      expect(await readFile(join(root, 'restart_original.json'), 'utf8')).toBe(original)
    },
  })
  expect([JSON.parse(first.stdout), ...outputs]).toEqual([
    { phase: seedPhase, count: 1, revision: 2 },
    { phase: 'restore', count: 1, revision: 2, imported: 1, skipped: 0 },
    { phase: 'verify', count: 1, revision: 2, imported: 0, skipped: 1 },
  ])
}, LOADER_SMOKE_TEST_TIMEOUT_MS * 4)
