/** Same-origin restart handoff: origin fence, method and body bounds, supervisor detach. */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { LEON_RESTART_PATH, registerLeonRestart, type LeonRestartConfig } from '../src/leon-restart.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
})

const SCRIPT = join(tmpdir(), 'Reiniciar-Leon.ps1')

/** Complete same-origin request carrying only the facts the route reads. */
function restartPost(headers: Record<string, string>, body = ''): IncomingMessage {
  const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(request, {
    complete: true,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...headers },
    method: 'POST',
    url: LEON_RESTART_PATH,
  })
  return request
}

function fakeResponse(): { response: ServerResponse; state: { body?: string; status?: number } } {
  const state: { body?: string; status?: number } = {}
  const response = Object.assign(new EventEmitter(), {
    end(body?: string) {
      if (body !== undefined) state.body = body
      return this
    },
    writeHead(status: number) { state.status = status; return this },
  }) as unknown as ServerResponse
  return { response, state }
}

/** Mount only the restart route and hand back its captured registration. */
async function mountedRestartRoute(
  config: Partial<LeonRestartConfig> = {},
  trustedHosts: readonly string[] = [],
): Promise<{ dispose: () => Promise<void>; route?: WebRoute }> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  ctx.provide('webServer', {
    register(route: WebRoute) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
  } as WebServer)
  const fiber = ctx.plugin({
    apply(pluginCtx) {
      registerLeonRestart(pluginCtx, {
        scriptPath: config.scriptPath ?? SCRIPT,
        ...(config.program === undefined ? {} : { program: config.program }),
        environment: config.environment ?? [],
      }, trustedHosts)
    },
  })
  await fiber.await()
  return { dispose: () => fiber.dispose(), route: routes[0] }
}

function detachedChild(): ChildProcess {
  return Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess
}

describe('Leon restart handoff', () => {
  it('registers no route when the deployment names no supervisor script', async () => {
    const { route, dispose } = await mountedRestartRoute({ scriptPath: '' })
    expect(route).toBeUndefined()
    await dispose()
  })

  it('detaches the operator supervisor and answers accepted once', async () => {
    const child = detachedChild()
    vi.mocked(spawn).mockReturnValueOnce(child)
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(restartPost({}), response)

    expect(state.status).toBe(202)
    expect(JSON.parse(state.body ?? '{}')).toEqual({ accepted: true, supervisor: 'Reiniciar-Leon.ps1' })
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!
    expect(command).toBe(process.execPath)
    expect(args).toEqual(['-e', expect.any(String), SCRIPT])
    expect(args?.[1]).toContain('WindowsPowerShell')
    expect(options?.detached).toBe(true)
    expect(options?.stdio).toEqual('ignore')
    expect(child.unref).toHaveBeenCalledTimes(1)
    await dispose()
  })

  it('rejects a cross-site or rebound authority before reading any body', async () => {
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(
      restartPost({ host: 'attacker.example:3080', origin: 'http://attacker.example:3080' }),
      response,
    )
    expect(state.status).toBe(403)
    expect(state.body).toBe('forbidden')
    expect(spawn).not.toHaveBeenCalled()
    await dispose()
  })

  it.each([
    ['GET', 'METHOD_NOT_ALLOWED', 405],
  ] as const)('answers %s with %s', async (method, code, status) => {
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(Object.assign(restartPost({}), { method }) as IncomingMessage, response)
    expect(state.status).toBe(status)
    expect(JSON.parse(state.body ?? '{}').error.code).toBe(code)
    await dispose()
  })

  it('refuses a body over the bounded limit instead of buffering it', async () => {
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const request = Object.assign(Readable.from([Buffer.alloc(9 * 1024)]), {
      complete: true,
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
      method: 'POST',
      url: LEON_RESTART_PATH,
    }) as unknown as IncomingMessage
    const { response, state } = fakeResponse()
    await route.handler(request, response)
    expect(state.status).toBe(413)
    expect(JSON.parse(state.body ?? '{}').error.code).toBe('BODY_TOO_LARGE')
    expect(spawn).not.toHaveBeenCalled()
    await dispose()
  })

  it('reports a supervisor launch failure rather than leaving the socket hanging', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn ENOENT') })
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(restartPost({}), response)
    expect(state.status).toBe(500)
    expect(JSON.parse(state.body ?? '{}').error.code).toBe('SUPERVISOR_LAUNCH_FAILED')
    await dispose()
  })

  it('fences one in-flight handoff so a double click cannot queue two supervisors', async () => {
    const child = detachedChild()
    vi.mocked(spawn).mockReturnValue(child)
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    // A stream that never ends holds the first handler inside its critical
    // section, so the second request arrives while the first is still running.
    const stalled = Object.assign(new Readable({ read() {} }), {
      complete: false,
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
      method: 'POST',
      url: LEON_RESTART_PATH,
    }) as unknown as IncomingMessage
    const first = fakeResponse()
    const running = route.handler(stalled, first.response)
    const second = fakeResponse()
    await route.handler(restartPost({}), second.response)
    expect(second.state.status).toBe(429)
    expect(JSON.parse(second.state.body ?? '{}').error.code).toBe('RESTART_IN_FLIGHT')
    expect(spawn).not.toHaveBeenCalled()
    stalled.push(null)
    await running
    expect(first.state.status).toBe(202)
    expect(spawn).toHaveBeenCalledTimes(1)
    await dispose()
  })

  it('accepts an explicit LAN authority from the deployment trust list', async () => {
    const child = detachedChild()
    vi.mocked(spawn).mockReturnValueOnce(child)
    const { route, dispose } = await mountedRestartRoute({}, ['192.168.1.5'])
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(
      restartPost({ host: '192.168.1.5:3080', origin: 'http://192.168.1.5:3080' }),
      response,
    )
    expect(state.status).toBe(202)
    await dispose()
  })

  it('forwards only the allowlisted pairs over the scrubbed parent environment', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'must-not-reach-supervisor')
    vi.stubEnv('DSH_HOME', 'D:\\Leon\\data')
    const child = detachedChild()
    vi.mocked(spawn).mockReturnValueOnce(child)
    const { route, dispose } = await mountedRestartRoute({
      environment: ['LEON_RESTART_NOTE=verified', 'MALFORMED'],
    })
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(restartPost({}), response)
    expect(state.status).toBe(202)
    const options = vi.mocked(spawn).mock.calls[0]![2]
    expect(options?.env).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(options?.env).toMatchObject({ LEON_RESTART_NOTE: 'verified' })
    expect(options?.cwd).toBe(join(tmpdir()))
    vi.unstubAllEnvs()
    await dispose()
  })

  it('spawns a configured program directly with only the script argument', async () => {
    const child = detachedChild()
    vi.mocked(spawn).mockReturnValueOnce(child)
    const { route, dispose } = await mountedRestartRoute({ program: 'cmd.exe' })
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(restartPost({}), response)
    expect(state.status).toBe(202)
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!
    expect(command).toBe('cmd.exe')
    expect(args).toEqual([SCRIPT])
    expect(options?.detached).toBe(true)
    await dispose()
  })

  it('treats a broken request stream as an oversized body rather than launching', async () => {
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const broken = Object.assign(new Readable({ read() {} }), {
      complete: false,
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
      method: 'POST',
      url: LEON_RESTART_PATH,
    }) as unknown as IncomingMessage
    const { response, state } = fakeResponse()
    const running = route.handler(broken, response)
    broken.destroy(new Error('aborted upload'))
    await running
    expect(state.status).toBe(413)
    expect(JSON.parse(state.body ?? '{}').error.code).toBe('BODY_TOO_LARGE')
    expect(spawn).not.toHaveBeenCalled()
    await dispose()
  })

  it('reports a rejected restart handoff instead of pretending it happened', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => { throw 'supervisor unavailable' as never })
    const { route, dispose } = await mountedRestartRoute()
    if (route === undefined) throw new Error('expected the restart route')
    const { response, state } = fakeResponse()
    await route.handler(restartPost({}), response)
    expect(state.status).toBe(500)
    expect(JSON.parse(state.body ?? '{}').error.message).toBe('supervisor unavailable')
    await dispose()
  })

  it('releases the route on disposal', async () => {
    const { route, dispose } = await mountedRestartRoute()
    expect(route?.path).toBe(LEON_RESTART_PATH)
    await dispose()
    // A fresh mount re-registers the same seat, proving the disposer removed it.
    const remounted = await mountedRestartRoute()
    expect(remounted.route?.path).toBe(LEON_RESTART_PATH)
    await remounted.dispose()
  })
})
