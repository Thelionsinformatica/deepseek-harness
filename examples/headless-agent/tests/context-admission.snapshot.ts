/** Source/process snapshot: queued required instructions are retained when admission refuses. */
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { expect, it } from 'vitest'

it('admits request 1, refuses request 2 after late injection, and refuses unchanged replay', async () => {
  const binScript = fileURLToPath(new URL('./fixtures/context-admission-driver.ts', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'late context admission',
    tempDirPrefix: 'dsh-context-admission-',
    binScript,
    libBinScript: binScript,
    configPath: fileURLToPath(new URL('../context-admission.cordis.snapshot.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url)),
  })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
    {
      "adapterCalls": 1,
      "compactions": 0,
      "outcomes": [
        {
          "kind": "adapter-called",
          "request": 1,
        },
        {
          "beforeInference": true,
          "code": "CONTEXT_WINDOW_EXCEEDED",
          "kind": "request-refused",
          "request": 2,
        },
      ],
      "readResults": 1,
      "replay": [
        {
          "code": "CONTEXT_WINDOW_EXCEEDED",
          "kind": "request-refused",
        },
      ],
      "requiredInstructions": {
        "baselinePreserved": true,
        "characters": 46688,
        "preserved": true,
        "replayUnchanged": true,
      },
    }
  `)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
