import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('validates exact tasks through Loader and refuses a repeated mismatch', async () => {
  const runner = fileURLToPath(new URL('./fixtures/task-acceptance-runner.ts', import.meta.url))
  const configPath = fileURLToPath(new URL('../task-acceptance.cordis.yml', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'task acceptance', tempDirPrefix: 'leon-task-acceptance-',
    binScript: runner, libBinScript: runner, binArgs: [configPath], configPath,
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  })
  const transcript = JSON.parse(result.stdout) as Array<{ type: string; status?: string }>
  expect(transcript.filter(e => e.type === 'task/validation').map(e => e.status)).toEqual(['retry', 'passed', 'retry', 'failed', 'retry', 'passed'])
  expect(transcript).toMatchSnapshot()
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
