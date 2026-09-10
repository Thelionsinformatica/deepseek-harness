import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const runner = fileURLToPath(new URL('./fixtures/web-approval-runner.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../web-approval.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('outbound web approval through the runnable headless example', () => {
  it('logs one-shot consent and contacts providers only for approved calls', async () => {
    const result = await runLoaderSmoke({
      label: 'web approval snapshot', tempDirPrefix: 'leon-web-approval-',
      binScript: runner, libBinScript: runner, binArgs: [configPath], configPath, tsconfigPath,
    })
    expect(result.stderr).toBe('')
    const output = JSON.parse(result.stdout) as { outbound: unknown; transcript: unknown }
    expect(output.outbound).toEqual([
      { operation: 'search', query: 'public topic' },
      { operation: 'fetch', url: 'https://example.test/public' },
    ])
    expect(JSON.stringify(output.outbound)).not.toContain('PRIVATE_CANARY')
    expect(output).toMatchSnapshot()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
