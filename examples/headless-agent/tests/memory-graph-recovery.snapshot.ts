import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('recovers a graph from local outage and oversized batches without losing input coverage', async () => {
  const runner = fileURLToPath(new URL('./fixtures/memory-graph-recovery-runner.ts', import.meta.url))
  const configPath = fileURLToPath(new URL('../memory-graph-recovery.cordis.yml', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'bounded memory graph recovery', tempDirPrefix: 'leon-memory-graph-recovery-',
    binScript: runner, libBinScript: runner, configPath, mode: 'lib', binArgs: [configPath],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  })
  expect(JSON.parse(result.stdout)).toEqual({
    status: 'computed', algorithmVersion: 2, records: 2, edges: 1,
    statuses: ['failed', 'computed'], contentPreserved: true, completeInputCoverage: true,
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
