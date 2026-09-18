import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('completes an evidence-checked import mission with two real Team sessions', async () => {
  const config = fileURLToPath(new URL('../collective.cordis.snapshot.yml', import.meta.url))
  let state: unknown
  let policy: unknown
  let roleContext = false
  const bin = fileURLToPath(new URL('../../../packages/experimental/agent-team/lib/lab-bin.js', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'Leon collective mission', tempDirPrefix: 'leon-collective-',
    binScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/src/lab-bin.ts', import.meta.url)),
    libBinScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/lib/lab-bin.js', import.meta.url)),
    configPath: config, binArgs: ['run', '--cwd', config],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 120000,
    inspect: async (cwd) => {
      const data: unknown = JSON.parse(await readFile(join(cwd, 'control', 'leon_collective.json'), 'utf8'))
      if (typeof data !== 'object' || data === null || !('tables' in data)) throw new Error('Missing tables')
      const tables = data.tables
      if (typeof tables !== 'object' || tables === null || !('missions' in tables)) throw new Error('Missing missions')
      const missions = tables.missions
      if (typeof missions !== 'object' || missions === null || !('leon-collective' in missions)) throw new Error('Missing mission')
      state = missions['leon-collective']
      policy = JSON.parse(await readFile(join(cwd, 'import-policy.json'), 'utf8'))
      const root = join(cwd, 'sessions')
      for (const file of await readdir(root, { recursive: true })) {
        if (file.endsWith('session.jsonl') && (await readFile(join(root, file), 'utf8')).includes('Identidade operacional:')) roleContext = true
      }
      const invoke = promisify(execFile)
      const stopped = await invoke(process.execPath, [bin, 'stop', cwd, config], { timeout: 30000 })
      expect(stopped.stdout).toContain('"state":"cancelled"')
      await expect(invoke(process.execPath, [bin, 'resume', cwd, config], { timeout: 30000 })).rejects.toThrow()
      const status = await invoke(process.execPath, [bin, 'status', cwd, config], { timeout: 30000 })
      expect(status.stdout).toContain('"state":"cancelled"')
    },
  })
  expect(result.stderr).toBe('')
  expect(state).toMatchObject({ state: 'completed' })
  expect(policy).toEqual({ mode: 'upsert' })
  expect(roleContext).toBe(true)
  expect(result.stdout).toContain('mission_verify')
  expect(result.stdout).toContain('NO_DUPLICATE_SOURCE')
}, 135000)

it('rejects an unbound reviewer through the real Loader before inference without approving the mission', async () => {
  const config = fileURLToPath(new URL('../collective-reserve.cordis.snapshot.yml', import.meta.url))
  let denied = false
  const result = await runLoaderSmoke({
    label: 'Collective reserved calls', tempDirPrefix: 'leon-reserve-',
    binScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/src/lab-bin.ts', import.meta.url)),
    libBinScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/lib/lab-bin.js', import.meta.url)),
    configPath: config, binArgs: ['run', '--cwd', config],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 60000, expectedExitCode: 2,
    inspect: async (cwd) => {
      const root = join(cwd, 'sessions')
      for (const file of await readdir(root, { recursive: true })) {
        if (!file.endsWith('session.jsonl')) continue
        const text = await readFile(join(root, file), 'utf8')
        if (text.includes('Review reserve requires an existing teammate session in this mission')) denied = true
      }
      expect(JSON.parse(await readFile(join(cwd, 'import-policy.json'), 'utf8'))).toEqual({ mode: 'append' })
    },
  })
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line) as { session?: string; event?: { type: string }; mission?: { state: string; calls: number; maxCalls: number } })
  expect(rows.filter(row => row.session === 'leon-collective' && row.event?.type === 'tool/call')).toHaveLength(0)
  expect(rows.some(row => row.session !== 'leon-collective' && row.event?.type === 'tool/call')).toBe(false)
  expect(rows.at(-1)?.mission).toMatchObject({ state: 'blocked', calls: 0, maxCalls: 48 })
  expect(rows.at(-1)?.mission?.calls).toBeLessThan(48)
  expect(denied).toBe(true)
}, 75000)
