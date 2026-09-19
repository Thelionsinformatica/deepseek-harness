import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const runtime = join(root, 'apps/cli/tests/fixtures/collective-runtime.mjs')
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
  value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(name)))

async function fixture(options: { code?: number; mode?: string } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'leon-collective-runtime-'))
  const workspace = join(folder, 'task with spaces & literal')
  const config = join(folder, 'explicit config.yml')
  await mkdir(workspace)
  await writeFile(config, JSON.stringify(options))
  return {
    folder, workspace, config,
    args: ['--runtime', runtime, '--config', config, '--workspace', workspace, '--action', 'run', '--scenario', 'import-idempotency'],
    cleanup: () => rm(folder, { recursive: true, force: true }),
  }
}

function source(args: string[], interrupt = false) {
  return execa(process.execPath, [
    '--import', 'tsx/esm',
    interrupt ? 'apps/cli/tests/fixtures/collective-cli-interrupt.mjs' : 'apps/cli/src/bin.ts',
    'collective', ...args,
  ], {
    cwd: root, env: { ...safeEnv, FIXTURE_SECRET: 'not-a-real-secret', DSH_HOME: 'must-not-inherit',
      LEON_COLLECTIVE_LOCAL_TOKEN: 'must-not-inherit', OPENAI_API_KEY: 'fixture-only' },
    extendEnv: false, input: '', timeout: 25_000, killSignal: 'SIGKILL', reject: false,
  })
}

// Explicit source-path coverage complements the compiled artifact smoke owned by the integration runner.
describe('collective explicit runtime bridge', () => {
  for (const action of ['run', 'resume', 'status', 'stop']) {
    it(`forwards ${action} without a shell or ambient credentials`, async () => {
      const f = await fixture({ code: 2 })
      try {
        const args = [...f.args]
        args[args.indexOf('--action') + 1] = action
        const result = await source(args)
        expect(result.timedOut).toBe(false)
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toBe('')
        const output = JSON.parse(result.stdout) as { environment: string[] }
        expect(output).toMatchObject({ action, workspace: f.workspace, config: f.config, cwd: f.workspace,
          placeholder: 'local-placeholder', status: 'fixture-only' })
        for (const name of ['FIXTURE_SECRET', 'DSH_HOME', 'OPENAI_API_KEY', 'NODE_OPTIONS']) {
          expect(output.environment).not.toContain(name)
        }
        expect(await readdir(f.workspace)).toEqual([])
      } finally { await f.cleanup() }
    }, 30_000)
  }

  it('preserves runtime exit codes and reports a child exception as failure', async () => {
    for (const options of [{ code: 7 }, { mode: 'throw' }]) {
      const f = await fixture(options)
      try {
        const result = await source(f.args)
        expect(result.exitCode).toBe(options.code ?? 1)
        if (options.mode) expect(result.stderr).toContain('fixture-runtime-error')
      } finally { await f.cleanup() }
    }
  }, 60_000)

  it('never executes the runtime during preview, even with execution flags', async () => {
    const f = await fixture({ mode: 'throw' })
    try {
      const result = await source([...f.args, '--dry-run', '--json', 'texto somente ilustrativo'])
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'dry-run', executed: false, persisted: false })
      expect(await readdir(f.workspace)).toEqual([])
    } finally { await f.cleanup() }
  }, 30_000)

  it('rejects unsupported flags and paths before spawning a runtime', async () => {
    const f = await fixture()
    try {
      const cases = [
        ['--runtime', 'relative.mjs'], ['--runtime', f.workspace], ['--runtime', join(root, 'apps/cli/src/bin.ts')],
        ['--config', f.workspace], ['--workspace', f.config], ['--action', 'approve'],
        ['--scenario', 'arbitrary'], ['--config', join(f.folder, 'missing.yml')],
      ]
      for (const [flag, value] of cases) {
        const args = [...f.args]
        args[args.indexOf(flag!) + 1] = value!
        const result = await source([...args, '--json'])
        expect(result.exitCode).toBe(2)
        expect(JSON.parse(result.stdout)).toMatchObject({ code: 'COLLECTIVE_RUNTIME_INVALID', executed: false })
      }
      for (const args of [[...f.args, 'execute algo diferente'], ['--runtime', runtime]]) {
        const result = await source([...args, '--json'])
        expect(result.exitCode).toBe(2)
        expect(JSON.parse(result.stdout)).toMatchObject({ code: 'COLLECTIVE_RUNTIME_INVALID', executed: false })
      }
      expect(await readdir(f.workspace)).toEqual([])
    } finally { await f.cleanup() }
  }, 120_000)

  it('waits for the interrupted child and returns a non-successful cancellation code', async () => {
    const f = await fixture({ mode: 'wait' })
    try {
      const result = await source(f.args, true)
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(130)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fixture-only' })
      expect(await readdir(f.workspace)).toEqual(['fixture-ready'])
    } finally { await f.cleanup() }
  }, 30_000)
})
