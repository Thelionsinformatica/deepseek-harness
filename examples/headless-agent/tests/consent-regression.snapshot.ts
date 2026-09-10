import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('revokes prior external consent for terminal and unclassified results in the real loop', async () => {
  const runner = fileURLToPath(new URL('./fixtures/consent-regression-runner.ts', import.meta.url))
  const config = fileURLToPath(new URL('../consent-regression.cordis.yml', import.meta.url))
  const result = await runLoaderSmoke({ label: 'consent regression', tempDirPrefix: 'leon-consent-',
    binScript: runner, libBinScript: runner, configPath: config, binArgs: [config],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)), processTimeoutMs: 60000 })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual([
    { tool: 'terminal_read', cloudCalls: 0, calls: 1, failover: false },
    { tool: 'crm_query', cloudCalls: 0, calls: 1, failover: false },
    { tool: 'web_fetch', cloudCalls: 1, calls: 1, failover: true },
  ])
}, 70000)
