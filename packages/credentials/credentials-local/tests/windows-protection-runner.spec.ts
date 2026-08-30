import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runnerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  type Scenario = 'success' | 'exit' | 'output-overflow' | 'stderr-overflow' | 'spawn-error' | 'stdin-error' | 'timeout'

  class Emitter {
    private readonly listeners = new Map<string, Listener[]>()

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? []
      listeners.push(listener)
      this.listeners.set(event, listeners)
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }

  interface FakeChild extends Emitter {
    stdout: Emitter
    stderr: Emitter
    stdin: Emitter & { end(input: Buffer): void }
    kill: ReturnType<typeof vi.fn>
  }

  interface FakeSpawnOptions {
    env: NodeJS.ProcessEnv
    shell: boolean
    stdio: string[]
    windowsHide: boolean
  }

  const state: {
    scenario: Scenario
    input: Buffer | undefined
    child: FakeChild | undefined
  } = {
    scenario: 'success',
    input: undefined,
    child: undefined,
  }

  const spawn = vi.fn((_executable: string, _argv: string[], _options: FakeSpawnOptions): FakeChild => {
    const child = new Emitter() as FakeChild
    child.stdout = new Emitter()
    child.stderr = new Emitter()
    const stdin = new Emitter() as FakeChild['stdin']
    stdin.end = (input: Buffer): void => {
      state.input = Buffer.from(input)
      queueMicrotask(() => {
        switch (state.scenario) {
          case 'success':
            child.stdout.emit('data', Buffer.from('first-'))
            child.stdout.emit('data', Buffer.from('second'))
            child.emit('close', 0)
            return
          case 'exit':
            child.stderr.emit('data', Buffer.from('bounded diagnostic'))
            child.emit('close', 7)
            return
          case 'output-overflow':
            child.stdout.emit('data', Buffer.alloc(70 * 1024))
            child.emit('close', null)
            return
          case 'stderr-overflow':
            child.stderr.emit('data', Buffer.alloc(65 * 1024))
            child.emit('close', null)
            return
          case 'spawn-error':
            child.emit('error', new Error('synthetic spawn error'))
            child.emit('close', 0)
            return
          case 'stdin-error':
            child.stdin.emit('error', new Error('synthetic stdin error'))
            child.emit('close', 0)
            return
          case 'timeout':
            return
        }
      })
    }
    child.stdin = stdin
    child.kill = vi.fn(() => true)
    state.child = child
    return child
  })

  return { spawn, state }
})

vi.mock('node:child_process', () => ({ spawn: runnerHarness.spawn }))

import {
  credentialProtectorForPlatform,
  runWindowsDpapi,
  WINDOWS_DPAPI_PROTECTION,
} from '../src/windows-protection.ts'

beforeEach(() => {
  runnerHarness.spawn.mockClear()
  runnerHarness.state.scenario = 'success'
  runnerHarness.state.input = undefined
  runnerHarness.state.child = undefined
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.stubEnv('WINDIR', 'C:\\Windows')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Windows PowerShell DPAPI runner', () => {
  it('keeps input out of argv and the scrubbed child environment', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-value-that-must-not-cross')
    const input = Buffer.from('stdin-only-value')

    await expect(runWindowsDpapi('protect', input)).resolves.toEqual(Buffer.from('first-second'))
    expect(runnerHarness.state.input).toEqual(input)
    const [executable, argv, options] = runnerHarness.spawn.mock.calls[0]!
    expect(executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(argv.join(' ')).not.toContain('stdin-only-value')
    expect(options.env).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(options).toMatchObject({ shell: false, windowsHide: true })
  })

  it('uses WINDIR when SystemRoot is absent and admits large input', async () => {
    vi.stubEnv('SystemRoot', undefined)
    vi.stubEnv('WINDIR', 'D:\\Win')
    const input = Buffer.alloc(70 * 1024, 1)

    await expect(runWindowsDpapi('unprotect', input)).resolves.toEqual(Buffer.from('first-second'))
    expect(runnerHarness.spawn.mock.calls[0]![0])
      .toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('rejects before spawn when Windows has no system-root environment', async () => {
    vi.stubEnv('SystemRoot', undefined)
    vi.stubEnv('WINDIR', undefined)

    await expect(runWindowsDpapi('protect', Buffer.alloc(0))).rejects.toThrow(/SystemRoot is unset/)
    expect(runnerHarness.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['exit', /exit code 7/],
    ['output-overflow', /returned too much data/],
    ['stderr-overflow', /excessive diagnostics/],
    ['spawn-error', /helper could not start/],
    ['stdin-error', /helper rejected its input/],
  ] as const)('contains the %s failure without helper output', async (scenario, message) => {
    runnerHarness.state.scenario = scenario

    await expect(runWindowsDpapi('protect', Buffer.from('private-input'))).rejects.toThrow(message)
    expect(runnerHarness.state.child?.kill).toHaveBeenCalledTimes(
      scenario === 'output-overflow' || scenario === 'stderr-overflow' || scenario === 'stdin-error' ? 1 : 0,
    )
  })

  it('kills and rejects a helper that exceeds the cryptographic timeout', async () => {
    vi.useFakeTimers()
    runnerHarness.state.scenario = 'timeout'
    const result = runWindowsDpapi('protect', Buffer.from('private-input'))
    const rejection = expect(result).rejects.toThrow(/timed out/)

    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(runnerHarness.state.child?.kill).toHaveBeenCalledTimes(1)
  })
})

describe('platform protection selection', () => {
  it('selects current-user DPAPI only for Windows', () => {
    expect(credentialProtectorForPlatform('linux')).toBeUndefined()
    expect(credentialProtectorForPlatform('win32')).toMatchObject({ kind: WINDOWS_DPAPI_PROTECTION })
  })
})
