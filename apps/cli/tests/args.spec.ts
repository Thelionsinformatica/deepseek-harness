import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  it('routes profile boots and the web alias, handing the rest to the app', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['web'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: [] })
    expect(parse(['web', '--patch', 'web.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: ['web.yml'], args: [] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'web', '-h']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
    expect(parse(['web', '--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
  })

  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', '@deepseek-ai/cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', '@deepseek-ai/cordis'] })
    // Unknown pnpm flags forward verbatim.
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  it('routes read-only doctor invocations', () => {
    expect(parse(['doctor']))
      .toEqual({ mode: 'doctor', profile: 'web', port: 3080, json: false })
    expect(parse(['doctor', '--profile', 'headless', '--port', '4175', '--json']))
      .toEqual({ mode: 'doctor', profile: 'headless', port: 4175, json: true })
  })

  it('routes offline backup and restore invocations', () => {
    expect(parse(['backup', '--dry-run', '--json'])).toEqual({
      mode: 'backup',
      dryRun: true,
      json: true,
      confirmStopped: false,
      passphraseStdin: false,
    })
    expect(parse(['backup', 'E:/backup/leon.leon-backup', '--confirm-stopped', '--passphrase-stdin'])).toEqual({
      mode: 'backup',
      output: 'E:/backup/leon.leon-backup',
      dryRun: false,
      json: false,
      confirmStopped: true,
      passphraseStdin: true,
    })
    expect(parse(['restore', 'leon.leon-backup'])).toEqual({
      mode: 'restore',
      archive: 'leon.leon-backup',
      apply: false,
      json: false,
      confirmStopped: false,
      passphraseStdin: false,
    })
    expect(parse(['restore', 'leon.leon-backup', '--target', 'E:/restored', '--apply', '--confirm-stopped', '--passphrase-stdin', '--json'])).toEqual({
      mode: 'restore',
      archive: 'leon.leon-backup',
      target: 'E:/restored',
      apply: true,
      json: true,
      confirmStopped: true,
      passphraseStdin: true,
    })
  })

  it('routes profile and web config dumps', () => {
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  it('rejects missing profile, removed flags, and contradictory inputs', () => {
    expect(exitCode([])).toBe(1)
    expect(exitCode(['tui'])).toBe(1) // an app argument without --profile has no app to reach
    expect(exitCode(['--config', 'c.yml'])).toBe(1) // removed
    expect(exitCode(['-p', 'task'])).toBe(1) // removed
    expect(exitCode(['run', 'task'])).toBe(1) // app-owned task replaced the launcher subcommand
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--bogus'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['--profile', 'web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
    expect(exitCode(['doctor', '--profile', ''])).toBe(1)
    expect(exitCode(['doctor', '--port', '0'])).toBe(1)
    expect(exitCode(['doctor', '--port', '65536'])).toBe(1)
    expect(exitCode(['doctor', '--port', 'not-a-port'])).toBe(1)
    expect(exitCode(['--profile', 'web', 'doctor'])).toBe(1)
    expect(exitCode(['backup', '--dry-run', '--passphrase-stdin'])).toBe(1)
    expect(exitCode(['--profile', 'web', 'backup'])).toBe(1)
    expect(exitCode(['restore'])).toBe(1)
    expect(exitCode(['restore', 'archive', '--target', ''])).toBe(1)
    expect(exitCode(['--profile', 'web', 'restore', 'archive'])).toBe(1)
  })

  it('keeps its own help for an invocation with no app to hand it to', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
