import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {
  SubprocessHandle,
  SubprocessRuntime,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalVoiceTranscriber,
  registerVoiceTranscription,
  type LocalVoiceTranscriptionConfig,
  type VoiceProcessLauncher,
} from '../src/voice-transcription.ts'

const roots: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): LocalVoiceTranscriptionConfig {
  const root = mkdtempSync(join(tmpdir(), 'leon-voice-worker-'))
  roots.push(root)
  const modelPath = join(root, 'model')
  mkdirSync(modelPath)
  const scriptPath = join(root, 'worker.mjs')
  writeFileSync(scriptPath, String.raw`
let buffer = Buffer.alloc(0)
let header
let blocked = false
let successful = 0
const reply = value => process.stdout.write(JSON.stringify(value) + '\n')
const drain = () => {
  while (!blocked) {
    if (header === undefined) {
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      header = JSON.parse(buffer.subarray(0, newline).toString('utf8'))
      buffer = buffer.subarray(newline + 1)
    }
    if (buffer.length < header.bytes) return
    const audio = buffer.subarray(0, header.bytes)
    buffer = buffer.subarray(header.bytes)
    const text = audio.toString('utf8')
    if (text === 'hang') { blocked = true; return }
    if (text === 'invalid') process.stdout.write('not-json\n')
    else if (text === 'invalid-utf8') process.stdout.write(Buffer.concat([
      Buffer.from('{"v":1,"type":"result","id":' + header.id + ',"ok":true,"text":"'),
      Buffer.from([255]),
      Buffer.from('"}\n'),
    ]))
    else if (text === 'oversize') process.stdout.write('x'.repeat(65537) + '\n')
    else if (text === 'fail') reply({ v: 1, type: 'result', id: header.id, ok: false, code: 'TRANSCRIPTION_FAILED' })
    else reply({ v: 1, type: 'result', id: header.id, ok: true, text: text + ':' + (++successful) })
    header = undefined
  }
}
process.stdin.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); drain() })
reply({ v: 1, type: 'ready' })
`)
  return {
    pythonPath: process.execPath,
    modelPath,
    scriptPath,
    maxBytes: 1024,
    timeoutMs: 5_000,
  }
}

/** Complete microphone POST carrying only the request facts the route reads. */
function voicePost(headers: Record<string, string>, audio = 'encoded audio'): IncomingMessage {
  const request = Readable.from([Buffer.from(audio)]) as unknown as IncomingMessage
  Object.assign(request, {
    complete: true,
    headers: { 'content-type': 'audio/webm', ...headers },
    method: 'POST',
    url: '/api/leon/voice/transcribe',
  })
  return request
}

/** Response recorder for both the plain-text fence and JSON route outcomes. */
function fakeResponse(): {
  response: ServerResponse
  state: { body?: string; status?: number }
} {
  const state: { body?: string; status?: number } = {}
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    end(body?: string) {
      if (body !== undefined) state.body = body
      this.writableEnded = true
      return this
    },
    writeHead(status: number) { state.status = status; return this },
  }) as unknown as ServerResponse
  return { response, state }
}

/** Mount only the exact voice route, optionally with the persistent fixture. */
async function mountedVoiceRoute(
  trustedHosts: readonly string[] = [],
  availableWorker = false,
): Promise<{
  children: ChildProcessWithoutNullStreams[]
  dispose: () => Promise<void>
  route: WebRoute
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  const children: ChildProcessWithoutNullStreams[] = []
  const workerRuntime = capturingLauncher(children)
  ctx.provide('webServer', {
    register(route: WebRoute) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
  } as WebServer)
  ctx.provide('subprocess', {
    spawn: workerRuntime.launch,
  } as unknown as SubprocessRuntime)
  const config = fixture()
  if (!availableWorker) config.pythonPath = join(config.modelPath, 'missing-python')
  const fiber = ctx.plugin({
    apply(pluginCtx) {
      registerVoiceTranscription(pluginCtx, config, trustedHosts)
    },
  })
  await fiber.await()
  expect(routes).toHaveLength(1)
  return { children, dispose: () => fiber.dispose(), route: routes[0]! }
}

function capturingLauncher(children: ChildProcessWithoutNullStreams[] = []): {
  launch: VoiceProcessLauncher
  specs: SubprocessSpawnSpec[]
} {
  const specs: SubprocessSpawnSpec[] = []
  return {
    specs,
    launch: (spec) => {
      specs.push(spec)
      const command = spec.argv[0]
      if (command === undefined) throw new Error('missing worker executable')
      const env = Object.fromEntries(Object.entries(spec.env ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ))
      const child = spawn(command, spec.argv.slice(1), {
        cwd: spec.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      children.push(child)
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject)
          child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
        },
      )
      return {
        pid: child.pid ?? -1,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        collected: {},
        done,
        terminate() {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        },
        async waitForExit(signal?: AbortSignal): Promise<boolean> {
          if (child.exitCode !== null || child.signalCode !== null) return true
          return new Promise<boolean>((resolve) => {
            let settled = false
            const finish = (exited: boolean): void => {
              if (settled) return
              settled = true
              child.removeListener('close', onClose)
              signal?.removeEventListener('abort', onAbort)
              resolve(exited)
            }
            const onClose = (): void => { finish(true) }
            const onAbort = (): void => { finish(false) }
            child.once('close', onClose)
            signal?.addEventListener('abort', onAbort, { once: true })
            if (signal?.aborted) finish(false)
            else if (child.exitCode !== null || child.signalCode !== null) finish(true)
          })
        },
      } satisfies SubprocessHandle
    },
  }
}

function expectClosed(child: ChildProcessWithoutNullStreams | undefined): void {
  expect(child !== undefined && (child.exitCode !== null || child.signalCode !== null)).toBe(true)
}

describe('persistent local voice transcription worker', () => {
  it('loads once, serializes recordings, and uses a scrubbed offline environment', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'must-not-reach-worker')
    vi.stubEnv('PYTHONPATH', 'must-not-alter-worker-imports')
    const children: ChildProcessWithoutNullStreams[] = []
    const captured = capturingLauncher(children)
    const transcriber = createLocalVoiceTranscriber(fixture(), captured.launch)

    await expect(transcriber.transcribe(Buffer.from('first'))).resolves.toBe('first:1')
    await expect(transcriber.transcribe(Buffer.from('second'))).resolves.toBe('second:2')

    expect(children).toHaveLength(1)
    expect(captured.specs[0]?.graceMs).toBe(1_000)
    expect(captured.specs[0]?.stdio).toEqual({
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    expect(captured.specs[0]?.env).not.toHaveProperty('GOOGLE_API_KEY')
    expect(captured.specs[0]?.env).toHaveProperty('PYTHONPATH', undefined)
    expect(captured.specs[0]?.env?.PYTHONNOUSERSITE).toBe('1')
    expect(captured.specs[0]?.env?.TRANSFORMERS_OFFLINE).toBe('1')
    await transcriber.dispose()
    expectClosed(children[0])
  })

  it('fails before spawning when the offline runtime is absent', async () => {
    const config = fixture()
    config.pythonPath = join(config.modelPath, 'missing-python')
    const launch = vi.fn() as unknown as VoiceProcessLauncher
    const transcriber = createLocalVoiceTranscriber(config, launch)

    await expect(transcriber.transcribe(Buffer.from('voice'))).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_UNAVAILABLE',
    })
    expect(launch).not.toHaveBeenCalled()
    await transcriber.dispose()
  })

  it('does not spawn a worker for an already cancelled request', async () => {
    const launch = vi.fn() as unknown as VoiceProcessLauncher
    const transcriber = createLocalVoiceTranscriber(fixture(), launch)

    await expect(
      transcriber.transcribe(Buffer.from('voice'), AbortSignal.abort()),
    ).rejects.toMatchObject({
      status: 499,
      code: 'TRANSCRIPTION_CANCELLED',
    })
    expect(launch).not.toHaveBeenCalled()
    await transcriber.dispose()
  })

  it('classifies a synchronous launcher failure without exposing its details', async () => {
    const launch = vi.fn(() => { throw new Error('sensitive spawn detail') }) as unknown as VoiceProcessLauncher
    const transcriber = createLocalVoiceTranscriber(fixture(), launch)

    await expect(transcriber.transcribe(Buffer.from('voice'))).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_START_FAILED',
      message: 'The local transcriber could not start.',
    })
    await transcriber.dispose()
  })

  it('keeps a quiescent worker after one bounded transcription failure', async () => {
    const captured = capturingLauncher()
    const transcriber = createLocalVoiceTranscriber(fixture(), captured.launch)

    await expect(transcriber.transcribe(Buffer.from('fail'))).rejects.toMatchObject({
      status: 502,
      code: 'TRANSCRIPTION_FAILED',
    })
    await expect(transcriber.transcribe(Buffer.from('recovered'))).resolves.toBe('recovered:1')
    expect(captured.specs).toHaveLength(1)
    await transcriber.dispose()
  })

  it('cancels by discarding the worker and awaits its close before replacement', async () => {
    const children: ChildProcessWithoutNullStreams[] = []
    const captured = capturingLauncher(children)
    const transcriber = createLocalVoiceTranscriber(fixture(), captured.launch)
    const controller = new AbortController()
    const running = transcriber.transcribe(Buffer.from('hang'), controller.signal)
    await vi.waitFor(() => { expect(children).toHaveLength(1) })

    controller.abort()

    await expect(running).rejects.toMatchObject({
      status: 499,
      code: 'TRANSCRIPTION_CANCELLED',
    })
    expectClosed(children[0])
    await expect(transcriber.transcribe(Buffer.from('next'))).resolves.toBe('next:1')
    expect(children).toHaveLength(2)
    await transcriber.dispose()
  })

  it('times out, discards malformed or oversized output, and starts clean replacements', async () => {
    const config = fixture()
    config.timeoutMs = 100
    const children: ChildProcessWithoutNullStreams[] = []
    const captured = capturingLauncher(children)
    const transcriber = createLocalVoiceTranscriber(config, captured.launch)

    await expect(transcriber.transcribe(Buffer.from('hang'))).rejects.toMatchObject({
      status: 504,
      code: 'TRANSCRIPTION_TIMEOUT',
    })
    expectClosed(children[0])
    config.timeoutMs = 5_000
    await expect(transcriber.transcribe(Buffer.from('invalid'))).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_TRANSCRIBER_RESPONSE',
    })
    expectClosed(children[1])
    await expect(transcriber.transcribe(Buffer.from('invalid-utf8'))).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_TRANSCRIBER_RESPONSE',
    })
    expectClosed(children[2])
    await expect(transcriber.transcribe(Buffer.from('oversize'))).rejects.toMatchObject({
      status: 502,
      code: 'TRANSCRIBER_OUTPUT_LIMIT',
    })
    expectClosed(children[3])
    await expect(transcriber.transcribe(Buffer.from('clean'))).resolves.toBe('clean:1')
    expect(children).toHaveLength(5)
    await transcriber.dispose()
  })

  it('serializes admission and disposal reaches active-worker quiescence', async () => {
    const children: ChildProcessWithoutNullStreams[] = []
    const captured = capturingLauncher(children)
    const transcriber = createLocalVoiceTranscriber(fixture(), captured.launch)
    const running = transcriber.transcribe(Buffer.from('hang'))
    await vi.waitFor(() => { expect(children).toHaveLength(1) })

    await expect(transcriber.transcribe(Buffer.from('second'))).rejects.toMatchObject({
      status: 429,
      code: 'TRANSCRIBER_BUSY',
    })
    const disposal = transcriber.dispose()
    await expect(running).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_UNAVAILABLE',
    })
    await disposal
    expectClosed(children[0])
    await expect(transcriber.transcribe(Buffer.from('late'))).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_UNAVAILABLE',
    })
  })

  it('poisons the transcriber instead of reusing a worker without proven quiescence', async () => {
    const children: ChildProcessWithoutNullStreams[] = []
    const captured = capturingLauncher(children)
    let launched: SubprocessHandle | undefined
    const launch: VoiceProcessLauncher = (spec) => {
      const handle = captured.launch(spec)
      launched = handle
      return { ...handle, waitForExit: async () => false }
    }
    const transcriber = createLocalVoiceTranscriber(fixture(), launch)
    const controller = new AbortController()
    const running = transcriber.transcribe(Buffer.from('hang'), controller.signal)
    await vi.waitFor(() => { expect(children).toHaveLength(1) })

    controller.abort()

    await expect(running).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_STOP_FAILED',
    })
    await expect(transcriber.transcribe(Buffer.from('late'))).rejects.toMatchObject({
      code: 'TRANSCRIBER_STOP_FAILED',
    })
    expect(children).toHaveLength(1)
    await expect(transcriber.dispose()).rejects.toMatchObject({
      code: 'TRANSCRIBER_STOP_FAILED',
    })
    await launched?.done.catch(() => {})
  })
})

describe('local voice transcription route trust fence', () => {
  it('refuses a DNS-rebound Host before inspecting or transcribing audio', async () => {
    const { dispose, route } = await mountedVoiceRoute()
    const { response, state } = fakeResponse()

    await route.handler(voicePost({ host: 'attacker.example:3080' }), response)

    expect(state).toEqual({ status: 403, body: 'forbidden' })
    await dispose()
  })

  it('refuses cross-site browser markers even when the Host is loopback', async () => {
    const { dispose, route } = await mountedVoiceRoute()
    const { response, state } = fakeResponse()

    await route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }), response)

    expect(state).toEqual({ status: 403, body: 'forbidden' })
    await dispose()
  })

  it('admits a same-origin loopback POST to the offline worker boundary', async () => {
    const { dispose, route } = await mountedVoiceRoute()
    const { response, state } = fakeResponse()

    await route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }), response)

    expect(state.status).toBe(503)
    expect(JSON.parse(state.body ?? '{}')).toMatchObject({
      error: { code: 'TRANSCRIBER_UNAVAILABLE' },
    })
    await dispose()
  })

  it('uses the deployment trust list without accepting malformed authorities', async () => {
    const { dispose, route } = await mountedVoiceRoute(['lab.internal:3080'])
    const { response, state } = fakeResponse()

    await route.handler(voicePost({
      host: 'lab.internal:3080',
      origin: 'http://lab.internal:3080',
      'sec-fetch-site': 'same-origin',
    }), response)

    expect(state.status).toBe(503)
    await dispose()

    const ctx = new Context()
    ctx.provide('webServer', { register: vi.fn() } as unknown as WebServer)
    expect(() => {
      registerVoiceTranscription(ctx, fixture(), ['lab.internal/path'])
    }).toThrow(/not a bare host\[:port\] authority/)
  })

  it('admits only one local transcription at a time', async () => {
    const { dispose, route } = await mountedVoiceRoute([], true)
    const first = fakeResponse()
    const second = fakeResponse()

    const running = route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }), first.response)
    await route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }), second.response)

    expect(second.state.status).toBe(429)
    expect(JSON.parse(second.state.body ?? '{}')).toMatchObject({
      error: { code: 'TRANSCRIBER_BUSY' },
    })
    await running
    expect(first.state.status).toBe(200)
    await dispose()
  })

  it('turns a closed HTTP response into worker cancellation without a late write', async () => {
    const { children, dispose, route } = await mountedVoiceRoute([], true)
    const cancelled = fakeResponse()
    const running = route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }, 'hang'), cancelled.response)
    await vi.waitFor(() => { expect(children).toHaveLength(1) })

    cancelled.response.emit('close')
    await running

    expect(cancelled.state).toEqual({})
    const recovered = fakeResponse()
    await route.handler(voicePost({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }, 'recovered'), recovered.response)
    expect(recovered.state.status).toBe(200)
    await dispose()
  })
})
