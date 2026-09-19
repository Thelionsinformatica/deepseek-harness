/** Local speech-to-text HTTP route for Leon's browser microphone control. */

import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname } from 'node:path'
import type { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import {
  assertTrustedAuthority,
  isTrustedApiRequest,
} from '@deepseek-ai/dsh-client-connection'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Same-origin endpoint used only by the Leon Web composer. */
export const VOICE_TRANSCRIPTION_PATH = '/api/leon/voice/transcribe'

/** Deployment-owned runtime for the offline transcriber. */
export interface LocalVoiceTranscriptionConfig {
  /** Python executable containing PyAV and Vosk. */
  pythonPath: string
  /** Local Brazilian Portuguese Vosk model directory. */
  modelPath: string
  /** Python entrypoint distributed with this package. */
  scriptPath: string
  /** Complete request-body and worker-frame limit. */
  maxBytes: number
  /** Maximum worker startup or transcription lifetime. */
  timeoutMs: number
}

/** Injectable process launcher used by focused lifecycle tests. */
export type VoiceProcessLauncher = (
  spec: SubprocessSpawnSpec,
) => SubprocessHandle

/** Host-owned persistent worker used by the exact transcription route. */
export interface LocalVoiceTranscriber {
  /**
   * Transcribe one complete encoded recording.
   * @param audio - bounded browser recording bytes.
   * @param signal - caller cancellation; cancellation discards the worker.
   * @returns recognized Brazilian Portuguese text, possibly empty for silence.
   */
  transcribe(audio: Buffer, signal?: AbortSignal): Promise<string>
  /** Stop accepting work, discard the worker, and await process quiescence. */
  dispose(): Promise<void>
}

const WORKER_PROTOCOL_VERSION = 1
const MAX_WORKER_LINE_BYTES = 64 * 1024
const WORKER_STOP_GRACE_MS = 1_000
const WORKER_STOP_DEADLINE_MS = 5_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

class VoiceTranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'VoiceTranscriptionError'
  }
}

interface WorkerSlot {
  readonly handle: SubprocessHandle
  readonly stdin: Writable
  readonly reader: WorkerLineReader
  closedNow: boolean
  ready: boolean
  failure?: VoiceTranscriptionError
  retirement?: Promise<void>
}

interface WorkerResponse {
  readonly ok: boolean
  readonly text?: string
}

/** Answer one JSON response without exposing subprocess details. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function cancellationFailure(signal: AbortSignal): VoiceTranscriptionError {
  return signal.reason instanceof VoiceTranscriptionError
    ? signal.reason
    : new VoiceTranscriptionError(
      'Local speech recognition was cancelled.', 499, 'TRANSCRIPTION_CANCELLED',
    )
}

function errorFrom(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : 'Worker operation failed.')
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellationFailure(signal)
}

/** Read a complete audio body while enforcing the configured byte limit. */
async function readAudio(
  req: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  throwIfCancelled(signal)
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const size = Number(declared)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new VoiceTranscriptionError('Invalid audio length.', 400, 'INVALID_AUDIO_LENGTH')
    }
    if (size > maxBytes) {
      throw new VoiceTranscriptionError('The recording is too large.', 413, 'AUDIO_TOO_LARGE')
    }
  }
  const abort = (): void => {
    if (!req.destroyed) req.destroy(cancellationFailure(signal))
  }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of req as AsyncIterable<Uint8Array>) {
      throwIfCancelled(signal)
      const bytes = Buffer.from(chunk)
      total += bytes.length
      if (total > maxBytes) {
        throw new VoiceTranscriptionError('The recording is too large.', 413, 'AUDIO_TOO_LARGE')
      }
      chunks.push(bytes)
    }
  } catch (error) {
    throwIfCancelled(signal)
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
  if (!req.complete) throw new VoiceTranscriptionError('The audio upload was interrupted.', 400, 'AUDIO_ABORTED')
  if (total === 0) throw new VoiceTranscriptionError('The recording is empty.', 400, 'EMPTY_AUDIO')
  return Buffer.concat(chunks, total)
}

/** One bounded newline reader for the persistent worker's stdout protocol. */
class WorkerLineReader {
  private buffer = Buffer.alloc(0)
  private queued: string | undefined
  private waiter: {
    resolve: (line: string) => void
    reject: (error: Error) => void
  } | undefined
  private failure: Error | undefined

  constructor(private readonly onFailure: (error: Error) => void) {}

  push(chunk: Buffer): void {
    if (this.failure !== undefined || chunk.length === 0) return
    this.buffer = this.buffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const newline = this.buffer.indexOf(0x0a)
      if (newline < 0) break
      if (newline > MAX_WORKER_LINE_BYTES) {
        this.fail(new VoiceTranscriptionError(
          'The local transcriber produced too much output.', 502, 'TRANSCRIBER_OUTPUT_LIMIT',
        ))
        return
      }
      let line: string
      try {
        line = new TextDecoder('utf-8', { fatal: true })
          .decode(this.buffer.subarray(0, newline))
          .replace(/\r$/, '')
      } catch {
        this.fail(new VoiceTranscriptionError(
          'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
        ))
        return
      }
      this.buffer = this.buffer.subarray(newline + 1)
      if (!this.deliver(line)) return
    }
    if (this.buffer.length > MAX_WORKER_LINE_BYTES) {
      this.fail(new VoiceTranscriptionError(
        'The local transcriber produced too much output.', 502, 'TRANSCRIBER_OUTPUT_LIMIT',
      ))
    }
  }

  read(): Promise<string> {
    if (this.queued !== undefined) {
      const line = this.queued
      this.queued = undefined
      return Promise.resolve(line)
    }
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.waiter !== undefined) {
      return Promise.reject(new Error('The worker protocol already has a pending reader.'))
    }
    return new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }

  fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.reject(error)
    this.onFailure(error)
  }

  isQuiescent(): boolean {
    return this.failure === undefined
      && this.queued === undefined
      && this.waiter === undefined
      && this.buffer.length === 0
  }

  private deliver(line: string): boolean {
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter.resolve(line)
      return true
    }
    if (this.queued === undefined) {
      this.queued = line
      return true
    }
    this.fail(new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    ))
    return false
  }
}

function workerEnvironment(): NodeJS.ProcessEnv {
  const blockedNames = new Set([
    'ALL_PROXY',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'PYTHONBREAKPOINT',
    'PYTHONHOME',
    'PYTHONINSPECT',
    'PYTHONPATH',
    'PYTHONSTARTUP',
  ])
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(scrubbedParentEnv())) {
    // Keep an explicit tombstone so the managed subprocess provider removes
    // its own scrubbed-base copy instead of merging the proxy/Python hook back.
    env[name] = blockedNames.has(name.toUpperCase()) ? undefined : value
  }
  return {
    ...env,
    HF_HUB_OFFLINE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    TRANSFORMERS_OFFLINE: '1',
  }
}

function protocolDocument(line: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    )
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    )
  }
  return value as Record<string, unknown>
}

function assertReady(line: string): void {
  const value = protocolDocument(line)
  if (value.v !== WORKER_PROTOCOL_VERSION || value.type !== 'ready') {
    throw new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    )
  }
}

function workerResponse(line: string, requestId: number): WorkerResponse {
  const value = protocolDocument(line)
  if (
    value.v !== WORKER_PROTOCOL_VERSION
    || value.type !== 'result'
    || value.id !== requestId
    || typeof value.ok !== 'boolean'
  ) {
    throw new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    )
  }
  if (value.ok) {
    if (typeof value.text !== 'string') {
      throw new VoiceTranscriptionError(
        'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
      )
    }
    return { ok: true, text: value.text.trim() }
  }
  if (value.code !== 'TRANSCRIPTION_FAILED') {
    throw new VoiceTranscriptionError(
      'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
    )
  }
  return { ok: false }
}

function waitForWorker<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  if (signal.aborted) return Promise.reject(cancellationFailure(signal))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      if (error !== undefined) reject(errorFrom(error))
      else resolve(value as T)
    }
    const onAbort = (): void => { finish(cancellationFailure(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      finish(new VoiceTranscriptionError(
        'Local speech recognition timed out.', 504, 'TRANSCRIPTION_TIMEOUT',
      ))
    }, timeoutMs)
    work.then((value) => { finish(undefined, value) }, (error: unknown) => { finish(error) })
  })
}

function writeRequest(slot: WorkerSlot, requestId: number, audio: Buffer): Promise<void> {
  const header = Buffer.from(`${JSON.stringify({
    v: WORKER_PROTOCOL_VERSION,
    type: 'transcribe',
    id: requestId,
    bytes: audio.length,
  })}\n`, 'utf8')
  const frame = Buffer.concat([header, audio], header.length + audio.length)
  return new Promise<void>((resolve, reject) => {
    slot.stdin.write(frame, (error?: Error | null) => {
      if (error !== undefined && error !== null) reject(error)
      else resolve()
    })
  })
}

function launchWorker(
  config: LocalVoiceTranscriptionConfig,
  launch: VoiceProcessLauncher,
): WorkerSlot {
  const reader = new WorkerLineReader((error) => {
    if (error instanceof VoiceTranscriptionError) slot.failure ??= error
    if (!slot.closedNow) slot.handle.terminate()
  })
  const pythonName = basename(config.pythonPath).toLowerCase()
  const isolationArgs = /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/.test(pythonName)
    ? ['-I', '-B', '-u']
    : []
  const handle = launch({
    argv: [
      config.pythonPath,
      ...isolationArgs,
      config.scriptPath,
      '--model', config.modelPath,
      '--max-bytes', String(config.maxBytes),
    ],
    cwd: dirname(config.scriptPath),
    env: workerEnvironment(),
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: WORKER_STOP_GRACE_MS,
  })
  const stdin = handle.stdin
  const stdout = handle.stdout
  const stderr = handle.stderr
  if (stdin === undefined || stdout === undefined || stderr === undefined) {
    handle.terminate()
    throw new VoiceTranscriptionError(
      'The local transcriber could not start.', 503, 'TRANSCRIBER_START_FAILED',
    )
  }
  const slot: WorkerSlot = {
    handle,
    stdin,
    reader,
    closedNow: false,
    ready: false,
  }
  let stderrBytes = 0
  const failTransport = (failure: VoiceTranscriptionError): void => {
    slot.failure ??= failure
    reader.fail(failure)
  }
  stdout.on('data', (chunk: Buffer | string) => {
    reader.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  })
  stdout.on('error', () => {
    failTransport(new VoiceTranscriptionError(
      'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
    ))
  })
  stderr.on('data', (chunk: Buffer | string) => {
    stderrBytes += Buffer.byteLength(chunk)
    if (stderrBytes > MAX_WORKER_LINE_BYTES) {
      failTransport(new VoiceTranscriptionError(
        'The local transcriber produced too much output.', 502, 'TRANSCRIBER_OUTPUT_LIMIT',
      ))
    }
  })
  stderr.on('error', () => {
    failTransport(new VoiceTranscriptionError(
      'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
    ))
  })
  stdin.on('error', () => {
    failTransport(new VoiceTranscriptionError(
      'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
    ))
  })
  void handle.done.then(
    () => {
      if (slot.closedNow) return
      slot.closedNow = true
      const failure = slot.failure ?? (slot.ready
        ? new VoiceTranscriptionError(
          'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
        )
        : new VoiceTranscriptionError(
          'The local transcriber could not start.', 503, 'TRANSCRIBER_START_FAILED',
        ))
      slot.failure = failure
      reader.fail(failure)
    },
    () => {
      if (slot.closedNow) return
      slot.closedNow = true
      const failure = new VoiceTranscriptionError(
        'The local transcriber could not start.', 503, 'TRANSCRIBER_START_FAILED',
      )
      slot.failure ??= failure
      reader.fail(slot.failure)
    },
  )
  return slot
}

/**
 * Create one lazily started Vosk worker that serializes recordings and keeps
 * its model loaded between successful requests.
 * @param config - validated runtime paths and resource limits.
 * @param launch - injectable child-process launcher.
 * @returns persistent transcriber with quiescent disposal.
 */
export function createLocalVoiceTranscriber(
  config: LocalVoiceTranscriptionConfig,
  launch: VoiceProcessLauncher,
): LocalVoiceTranscriber {
  let slot: WorkerSlot | undefined
  let active: Promise<string> | undefined
  let disposed = false
  let terminalFailure: VoiceTranscriptionError | undefined
  let nextRequestId = 1
  const lifetime = new AbortController()

  const retire = async (worker: WorkerSlot): Promise<void> => {
    if (worker.retirement !== undefined) return worker.retirement
    worker.retirement = (async () => {
      worker.handle.terminate()
      let quiescent = false
      try {
        quiescent = await worker.handle.waitForExit(
          AbortSignal.timeout(WORKER_STOP_DEADLINE_MS),
        )
      } catch {}
      if (!quiescent) {
        terminalFailure ??= new VoiceTranscriptionError(
          'The local transcriber could not be stopped safely.', 503, 'TRANSCRIBER_STOP_FAILED',
        )
        throw terminalFailure
      }
      // `waitForExit()` is the subprocess seam's whole-tree quiescence proof;
      // do not add an unbounded second wait on the direct-process outcome.
      if (slot === worker) slot = undefined
    })()
    return worker.retirement
  }

  const ensureWorker = async (signal: AbortSignal): Promise<WorkerSlot> => {
    throwIfCancelled(signal)
    if (terminalFailure !== undefined) throw terminalFailure
    const current = slot
    if (current !== undefined) {
      if (current.ready && !current.closedNow && current.reader.isQuiescent()) return current
      await retire(current)
    }
    if (
      !Number.isSafeInteger(config.maxBytes)
      || config.maxBytes < 1
      || !Number.isSafeInteger(config.timeoutMs)
      || config.timeoutMs < 1
      || config.timeoutMs > MAX_TIMER_DELAY_MS
      || !existsSync(config.pythonPath)
      || !existsSync(config.modelPath)
      || !existsSync(config.scriptPath)
    ) {
      throw new VoiceTranscriptionError(
        'Local speech recognition is not installed.', 503, 'TRANSCRIBER_UNAVAILABLE',
      )
    }
    let worker: WorkerSlot
    try {
      worker = launchWorker(config, launch)
    } catch (error) {
      if (error instanceof VoiceTranscriptionError) throw error
      throw new VoiceTranscriptionError(
        'The local transcriber could not start.', 503, 'TRANSCRIBER_START_FAILED',
      )
    }
    slot = worker
    try {
      const line = await waitForWorker(worker.reader.read(), signal, config.timeoutMs)
      assertReady(line)
      worker.ready = true
      if (!worker.reader.isQuiescent()) {
        throw new VoiceTranscriptionError(
          'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
        )
      }
      return worker
    } catch (error) {
      await retire(worker)
      throw error
    }
  }

  const run = async (audio: Buffer, callerSignal?: AbortSignal): Promise<string> => {
    if (terminalFailure !== undefined) throw terminalFailure
    if (disposed) {
      throw new VoiceTranscriptionError(
        'Local speech recognition is not available.', 503, 'TRANSCRIBER_UNAVAILABLE',
      )
    }
    if (audio.length === 0) {
      throw new VoiceTranscriptionError('The recording is empty.', 400, 'EMPTY_AUDIO')
    }
    if (audio.length > config.maxBytes) {
      throw new VoiceTranscriptionError('The recording is too large.', 413, 'AUDIO_TOO_LARGE')
    }
    const signal = callerSignal === undefined
      ? lifetime.signal
      : AbortSignal.any([callerSignal, lifetime.signal])
    throwIfCancelled(signal)
    const worker = await ensureWorker(signal)
    const requestId = nextRequestId
    nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1
    let line: string
    try {
      throwIfCancelled(signal)
      line = await waitForWorker(
        writeRequest(worker, requestId, audio).then(() => worker.reader.read()),
        signal,
        config.timeoutMs,
      )
    } catch (error) {
      await retire(worker)
      if (error instanceof VoiceTranscriptionError) throw error
      throw new VoiceTranscriptionError(
        'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
      )
    }
    let response: WorkerResponse
    try {
      response = workerResponse(line, requestId)
      if (!worker.reader.isQuiescent()) {
        throw new VoiceTranscriptionError(
          'The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE',
        )
      }
    } catch (error) {
      await retire(worker)
      throw error
    }
    if (!response.ok) {
      throw new VoiceTranscriptionError(
        'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
      )
    }
    return response.text ?? ''
  }

  return {
    async transcribe(audio, signal) {
      if (active !== undefined) {
        throw new VoiceTranscriptionError(
          'Local speech recognition is already processing another recording.', 429, 'TRANSCRIBER_BUSY',
        )
      }
      const operation = run(audio, signal)
      active = operation
      try {
        return await operation
      } finally {
        if (active === operation) active = undefined
      }
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        lifetime.abort(new VoiceTranscriptionError(
          'Local speech recognition is not available.', 503, 'TRANSCRIBER_UNAVAILABLE',
        ))
      }
      const operation = active
      if (operation !== undefined) await operation.catch(() => {})
      const worker = slot
      if (worker !== undefined) await retire(worker)
    },
  }
}

function canRespond(res: ServerResponse): boolean {
  return !res.destroyed && !res.writableEnded
}

/**
 * Register the same-origin route and retire its persistent worker on disposal.
 * @param ctx - Web application context that owns the route lifecycle.
 * @param config - Local speech-recognition worker limits and executable settings.
 * @param trustedHosts - Same deployment-owned authorities accepted by the `/api` bridge.
 */
export function registerVoiceTranscription(
  ctx: Context,
  config: LocalVoiceTranscriptionConfig,
  trustedHosts: readonly string[] = [],
): void {
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  ctx.inject(['subprocess'], (runtimeCtx) => {
    const transcriber = createLocalVoiceTranscriber(
      config,
      spec => runtimeCtx.subprocess.spawn(spec),
    )
    runtimeCtx.effect(() => {
      const requests = new Set<Promise<void>>()
      const controllers = new Set<AbortController>()
      let transcribing = false
      let disposing = false
      const unregister = runtimeCtx.webServer.register({
        kind: 'exact',
        path: VOICE_TRANSCRIPTION_PATH,
        handler: async (req, res) => {
          const operation = (async (): Promise<void> => {
            // Exact routes win before the Connection package's `/api` prefix
            // route. Apply its shared fence here before method, media, body, or
            // subprocess handling so a rebound/cross-site request has no oracle.
            if (!isTrustedApiRequest(req, trustedHosts)) {
              res.writeHead(403)
              res.end('forbidden')
              return
            }
            if (req.method !== 'POST') {
              json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } })
              return
            }
            const contentType = req.headers['content-type'] ?? ''
            if (!contentType.toLowerCase().startsWith('audio/')) {
              json(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send an audio recording.' } })
              return
            }
            if (transcribing) {
              json(res, 429, {
                error: {
                  code: 'TRANSCRIBER_BUSY',
                  message: 'Local speech recognition is already processing another recording.',
                },
              })
              return
            }
            transcribing = true
            const controller = new AbortController()
            controllers.add(controller)
            let responseClosed = false
            const abort = (): void => { controller.abort() }
            const abortOnResponseClose = (): void => {
              responseClosed = true
              if (!res.writableEnded) controller.abort()
            }
            const shouldRespond = (): boolean => !disposing && !responseClosed && canRespond(res)
            req.once('aborted', abort)
            res.once('close', abortOnResponseClose)
            try {
              const audio = await readAudio(req, config.maxBytes, controller.signal)
              const text = await transcriber.transcribe(audio, controller.signal)
              if (shouldRespond()) json(res, 200, { text })
            } catch (error) {
              if (shouldRespond()) {
                const failure = error instanceof VoiceTranscriptionError
                  ? error
                  : new VoiceTranscriptionError('Local speech recognition failed.', 500, 'TRANSCRIPTION_FAILED')
                json(res, failure.status, { error: { code: failure.code, message: failure.message } })
              }
            } finally {
              req.removeListener('aborted', abort)
              res.removeListener('close', abortOnResponseClose)
              controllers.delete(controller)
              transcribing = false
            }
          })()
          requests.add(operation)
          try {
            await operation
          } finally {
            requests.delete(operation)
          }
        },
      })
      return async () => {
        disposing = true
        unregister()
        for (const controller of controllers) {
          controller.abort(new VoiceTranscriptionError(
            'Local speech recognition is not available.', 503, 'TRANSCRIBER_UNAVAILABLE',
          ))
        }
        await transcriber.dispose()
        await Promise.allSettled(requests)
      }
    }, 'web-app: local voice transcription route')
  })
}
