/** Local speech-to-text HTTP route for Leon's browser microphone control. */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Same-origin endpoint used only by the Leon Web composer. */
export const VOICE_TRANSCRIPTION_PATH = '/api/leon/voice/transcribe'

/** Deployment-owned runtime for the offline transcriber. */
export interface LocalVoiceTranscriptionConfig {
  /** Python executable containing faster-whisper's decoder and Vosk. */
  pythonPath: string
  /** Local Brazilian Portuguese Vosk model directory. */
  modelPath: string
  /** Python entrypoint distributed with this package. */
  scriptPath: string
  /** Complete request-body limit. */
  maxBytes: number
  /** Maximum transcription process lifetime. */
  timeoutMs: number
}

/** Injectable process launcher used by focused lifecycle tests. */
export type VoiceProcessLauncher = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024

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

/** Answer one JSON response without exposing subprocess details. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Read a complete audio body while enforcing the configured byte limit. */
async function readAudio(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
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
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk)
    total += bytes.length
    if (total > maxBytes) {
      throw new VoiceTranscriptionError('The recording is too large.', 413, 'AUDIO_TOO_LARGE')
    }
    chunks.push(bytes)
  }
  if (!req.complete) throw new VoiceTranscriptionError('The audio upload was interrupted.', 400, 'AUDIO_ABORTED')
  if (total === 0) throw new VoiceTranscriptionError('The recording is empty.', 400, 'EMPTY_AUDIO')
  return Buffer.concat(chunks, total)
}

/** Parse the single JSON document emitted by the offline worker. */
function transcriptFrom(output: string): string {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new VoiceTranscriptionError('The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE')
  }
  const text = typeof value === 'object' && value !== null && 'text' in value
    ? (value as { text?: unknown }).text
    : undefined
  if (typeof text !== 'string') {
    throw new VoiceTranscriptionError('The local transcriber returned an invalid response.', 502, 'INVALID_TRANSCRIBER_RESPONSE')
  }
  return text.trim()
}

/**
 * Transcribe one recording in a hidden, credential-scrubbed child process.
 * @param config - validated runtime paths and resource limits.
 * @param audio - complete browser recording bytes.
 * @param launch - injectable child-process launcher.
 * @param onChild - lifecycle observer used by the route owner for teardown.
 * @returns recognized Brazilian Portuguese text, possibly empty for silence.
 */
export function transcribeLocally(
  config: LocalVoiceTranscriptionConfig,
  audio: Buffer,
  launch: VoiceProcessLauncher = spawn,
  onChild: (child: ChildProcessWithoutNullStreams) => void = () => {},
): Promise<string> {
  if (!existsSync(config.pythonPath) || !existsSync(config.modelPath) || !existsSync(config.scriptPath)) {
    return Promise.reject(new VoiceTranscriptionError(
      'Local speech recognition is not installed.', 503, 'TRANSCRIBER_UNAVAILABLE',
    ))
  }
  return new Promise<string>((resolve, reject) => {
    const child = launch(config.pythonPath, [config.scriptPath, '--model', config.modelPath], {
      cwd: config.modelPath,
      env: {
        ...scrubbedParentEnv(),
        HF_HUB_OFFLINE: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    onChild(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error, text?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.removeListener('error', onError)
      child.removeListener('close', onClose)
      if (error !== undefined) reject(error)
      else resolve(text ?? '')
    }
    const overflow = (): void => {
      child.kill()
      finish(new VoiceTranscriptionError(
        'The local transcriber produced too much output.', 502, 'TRANSCRIBER_OUTPUT_LIMIT',
      ))
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_PROCESS_OUTPUT_BYTES) overflow()
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (Buffer.byteLength(stderr) > MAX_PROCESS_OUTPUT_BYTES) overflow()
    })
    const onError = (error: Error): void => {
      finish(new VoiceTranscriptionError(
        `The local transcriber could not start: ${error.message}`, 503, 'TRANSCRIBER_START_FAILED',
      ))
    }
    const onClose = (code: number | null): void => {
      if (code !== 0) {
        finish(new VoiceTranscriptionError(
          'The local transcriber failed to process this recording.', 502, 'TRANSCRIPTION_FAILED',
        ))
        return
      }
      try {
        finish(undefined, transcriptFrom(stdout))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    child.once('error', onError)
    child.once('close', onClose)
    child.stdin.on('error', () => {
      // A failed worker also closes its stdin. The process error or exit code
      // owns the diagnostic, so this transport echo has no separate outcome.
    })
    const timeout = setTimeout(() => {
      child.kill()
      finish(new VoiceTranscriptionError(
        'Local speech recognition timed out.', 504, 'TRANSCRIPTION_TIMEOUT',
      ))
    }, config.timeoutMs)
    child.stdin.end(audio)
  })
}

/**
 * Register the same-origin route and retire every active worker on disposal.
 * @param ctx - Web application context that owns the route lifecycle.
 * @param config - Local speech-recognition worker limits and executable settings.
 */
export function registerVoiceTranscription(ctx: Context, config: LocalVoiceTranscriptionConfig): void {
  const children = new Set<ChildProcessWithoutNullStreams>()
  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'exact',
      path: VOICE_TRANSCRIPTION_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } })
          return
        }
        const contentType = req.headers['content-type'] ?? ''
        if (!contentType.toLowerCase().startsWith('audio/')) {
          json(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send an audio recording.' } })
          return
        }
        try {
          const audio = await readAudio(req, config.maxBytes)
          const text = await transcribeLocally(config, audio, spawn, (child) => {
            children.add(child)
            child.once('close', () => { children.delete(child) })
            child.once('error', () => { children.delete(child) })
          })
          json(res, 200, { text })
        } catch (error) {
          const failure = error instanceof VoiceTranscriptionError
            ? error
            : new VoiceTranscriptionError('Local speech recognition failed.', 500, 'TRANSCRIPTION_FAILED')
          json(res, failure.status, { error: { code: failure.code, message: failure.message } })
        }
      },
    })
    return async () => {
      unregister()
      const waits = [...children].map(child => new Promise<void>((resolve) => {
        child.once('close', () => { resolve() })
        child.kill()
      }))
      await Promise.all(waits)
      children.clear()
    }
  }, 'web-app: local voice transcription route')
}
