import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const hasPwsh = spawnSync(resolvePwshPath(), ['-NoProfile', '-NonInteractive', '-Command', '$true'], { stdio: 'ignore' }).status === 0

it.skipIf(!hasPwsh)('reports failed, handled, diagnostic, and explicit PowerShell exits in the assembled model transcript', async () => {
  const runner = fileURLToPath(new URL('./fixtures/pwsh-error-status-runner.ts', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'PowerShell error status', tempDirPrefix: 'dsh-pwsh-error-status-',
    binScript: runner, libBinScript: runner, mode: 'lib',
    configPath: fileURLToPath(new URL('../pwsh-error-status.cordis.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url)),
    async inspect(cwd) {
      const root = join(cwd, 'sessions')
      const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
      expect(files).toHaveLength(1)
      const log = await readFile(join(root, files[0]!), 'utf8')
      const results = log.trim().split('\n').map(line => JSON.parse(line) as SessionEvent)
        .filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(4)
      expect(results[0]!.data.message.content[0]).toMatchObject({ toolCallId: 'pwsh-status-0', isError: false })
      expect(JSON.stringify(results[0])).toContain('System.Byte[]')
      expect(JSON.stringify(results[0])).toContain('[exit code: 1]')
      expect(log).toContain('[exit code: 1]')
      expect(log).toContain('Unhandled failure stopped; handled and diagnostic output preserved.')
    },
  })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual([
    { call: 0, toolError: false, commandExit: 1, output: 'before\n[stderr]\n<PowerShell argument-conversion error>\n[exit code: 1]' },
    { call: 1, toolError: false, commandExit: 0, output: 'HANDLED' },
    { call: 2, toolError: false, commandExit: 0, output: 'DIAGNOSTIC\n[stderr]\nMethodException is diagnostic text' },
    { call: 3, toolError: false, commandExit: 7, output: '[stderr]\nnative diagnostic\n[exit code: 7]' },
  ])
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
