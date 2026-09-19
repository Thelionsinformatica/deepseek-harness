import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it.each(['collective-host', 'collective-host-v2'])('%s runs host-bound workers through the actual Loader with native tasks and current evidence', async (variant) => {
  const config = fileURLToPath(new URL(`../${variant}.cordis.snapshot.yml`, import.meta.url))
  const result = await runLoaderSmoke({
    label: 'Host collective mission', tempDirPrefix: 'leon-host-collective-',
    binScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/src/lab-bin.ts', import.meta.url)),
    libBinScript: fileURLToPath(new URL('../../../packages/experimental/agent-team/lib/lab-bin.js', import.meta.url)),
    configPath: config, binArgs: ['run', '--cwd', config],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    processTimeoutMs: 120000,
    inspect: async (cwd) => {
      const domain = JSON.parse(await readFile(join(cwd, 'control', 'leon_collective.json'), 'utf8')) as {
        tables: { missions: Record<string, { state: string; calls: number; maxCalls: number }> }
      }
      const mission = domain.tables.missions['leon-collective']
      if (mission === undefined) throw new Error('Missing durable mission')
      expect(mission).toMatchObject({ state: 'completed', maxCalls: 48 })
      expect(mission.calls).toBeLessThanOrEqual(48)
      expect(JSON.parse(await readFile(join(cwd, 'import-policy.json'), 'utf8'))).toEqual({ mode: 'upsert' })
      const files = (await readdir(join(cwd, 'sessions'), { recursive: true })).filter(name => name.endsWith('session.jsonl'))
      expect(files).toHaveLength(3)
      const records = await Promise.all(files.map(file => readFile(join(cwd, 'sessions', file), 'utf8')))
      expect(records.filter(record => record.includes('NO_DUPLICATE_SOURCE')).length).toBeGreaterThanOrEqual(2)
      const invoke = promisify(execFile)
      const bin = fileURLToPath(new URL('../../../packages/experimental/agent-team/lib/lab-bin.js', import.meta.url))
      const status = await invoke(process.execPath, [bin, 'status', cwd, config], { timeout: 30000 })
      expect(JSON.parse(status.stdout)).toMatchObject({ state: 'completed', calls: mission.calls })
      const stopped = await invoke(process.execPath, [bin, 'stop', cwd, config], { timeout: 30000 })
      expect(JSON.parse(stopped.stdout)).toMatchObject({ state: 'cancelled', calls: mission.calls })
      expect(await Promise.all(files.map(file => readFile(join(cwd, 'sessions', file), 'utf8')))).toEqual(records)
    },
  })
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('"composition":')
  expect(result.stdout).toContain('mission_verify')
  expect(result.stdout).not.toContain('"name":"spawn_teammate"')
}, 135000)
