/** Portable regression coverage for synchronous observation and asynchronous failure delivery. */

import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { spawnSubprocess } from '../src/spawn.ts'

const { ptyFailure, spawnPty } = vi.hoisted(() => {
  const ptyFailure = new Error('simulated native PTY allocation failure')
  return { ptyFailure, spawnPty: vi.fn(() => { throw ptyFailure }) }
})
vi.mock('node-pty', () => ({ spawn: spawnPty }))

it('settles an already-absent tree before scheduling termination escalation', async () => {
  const handle = spawnSubprocess({
    argv: [process.execPath, '-e', ''],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 20,
  })
  expect((await handle.done).exitCode).toBe(0)
  const timer = vi.spyOn(globalThis, 'setTimeout')
  const kill = vi.spyOn(process, 'kill')
  try {
    handle.terminate()
    expect(timer).not.toHaveBeenCalled()
    expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([])
    await expect(handle.waitForExit()).resolves.toBe(true)
    kill.mockClear()
    handle.terminate()
    expect(kill).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
  } finally {
    timer.mockRestore()
    kill.mockRestore()
  }
})

it('rejects terminal allocation failures without synchronous throws or deferred allocation', async () => {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalSubprocessRuntime)
  try {
    let pending!: Promise<SubprocessTerminalHandle>
    expect(() => {
      pending = ctx.subprocess.spawnTerminal({
        argv: ['unallocated-test-shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 20,
      })
    }).not.toThrow()
    expect(spawnPty).toHaveBeenCalledOnce()
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toBe(ptyFailure)
  } finally {
    await fiber.dispose()
  }
})
