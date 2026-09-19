import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it.each([
  ['partial-temp', 74],
  ['before-rename', 75],
  ['after-rename', 76],
] as const)('reopens a complete state after interruption at %s', async (stage, expectedExitCode) => {
  const seed = fileURLToPath(new URL('./fixtures/memory-restart-runner.ts', import.meta.url))
  const fault = fileURLToPath(new URL('./fixtures/memory-write-interruption-runner.ts', import.meta.url))
  const configPath = fileURLToPath(new URL('../memory-restart.cordis.yml', import.meta.url))
  const options = {
    label: 'interrupted memory write', tempDirPrefix: 'leon-write-fault-', configPath, mode: 'lib' as const,
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  }
  await runLoaderSmoke({
    ...options, binScript: seed, libBinScript: seed, binArgs: [configPath, 'seed'],
    env: { LEON_MEMORY_TEST_ROOT: '' },
    async inspect(cwd) {
      const root = join(cwd, 'store')
      const path = join(root, 'restart_original.json')
      const original = await readFile(path, 'utf8')
      const child = {
        ...options, binScript: fault, libBinScript: fault, env: { LEON_MEMORY_TEST_ROOT: root },
      }
      await runLoaderSmoke({ ...child, binArgs: [configPath, stage, 'interrupt'], expectedExitCode })
      const published = await readFile(path, 'utf8')
      const expected = JSON.parse(original) as {
        tables: { memories: Record<string, { revision: number; content: string }> }
      }
      if (stage === 'after-rename') {
        expected.tables.memories['restart-record']!.revision = 3
        expected.tables.memories['restart-record']!.content = 'New committed decision'
      } else {
        expect(published).toBe(original)
      }
      expect(JSON.parse(published)).toEqual(expected)
      const temps = (await readdir(root)).filter(name => name.endsWith('.tmp'))
      expect(temps).toHaveLength(stage === 'after-rename' ? 0 : 1)
      if (stage === 'partial-temp') {
        const partial = await readFile(join(root, temps[0]!), 'utf8')
        expect(() => { JSON.parse(partial) }).toThrow()
      }
      await runLoaderSmoke({ ...child, binArgs: [configPath, stage, 'verify'] })
      expect(await readFile(path, 'utf8')).toBe(published)
    },
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
