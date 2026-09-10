import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('restores memory through the built Loader and disposes the service', async () => {
  const runner = fileURLToPath(new URL('./fixtures/memory-continuity-runner.ts', import.meta.url))
  const configPath = fileURLToPath(new URL('../memory-continuity.cordis.yml', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'memory continuity', tempDirPrefix: 'leon-memory-loader-',
    binScript: runner, libBinScript: runner, binArgs: [configPath], configPath,
    mode: 'lib',
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    async inspect(cwd) {
      const persisted = await readFile(join(cwd, 'memory-snapshot.json'), 'utf8')
      expect(persisted).toContain('Use local memory')
    },
  })
  expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
    {
      "count": 1,
      "imported": 1,
      "skipped": 1,
    }
  `)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
