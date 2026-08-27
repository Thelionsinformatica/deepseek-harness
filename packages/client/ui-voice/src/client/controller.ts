/** Observable state machine for one browser microphone lifetime. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ActiveVoiceCapture, VoiceAudioClip, VoiceCaptureDriver,
} from './browser-capture.ts'

/** Visible capture phases. */
export type VoiceCaptureStatus =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'processing'
  | 'captured'
  | 'transcribed'
  | 'error'

/** Stable error codes translated by the presentation layer. */
export type VoiceCaptureErrorCode =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'unsupported'
  | 'empty-audio'
  | 'no-speech'
  | 'transcription-unavailable'
  | 'transcription-failed'
  | 'capture-failed'

/** JSON-safe clip summary exposed to the UI; audio bytes remain private. */
export interface VoiceClipSummary {
  readonly bytes: number
  readonly durationMs: number
  readonly mimeType: string
}

/** Immutable view consumed by the composer control. */
export interface VoiceCaptureView {
  readonly status: VoiceCaptureStatus
  readonly level: number
  readonly durationMs: number
  readonly clip: VoiceClipSummary | null
  readonly transcript: string | null
  readonly error: VoiceCaptureErrorCode | null
}

/** Optional future provider: convert one local recording into draft text. */
export type VoiceTranscriber = (clip: VoiceAudioClip) => Promise<string>

/** Tunable policy with deterministic clocks for tests. */
export interface VoiceCaptureControllerOptions {
  readonly now?: () => number
  readonly pollMs?: number
  readonly silenceMs?: number
  readonly speechThreshold?: number
  readonly maximumMs?: number
  readonly transcribe?: VoiceTranscriber
}

const INITIAL_VIEW: VoiceCaptureView = Object.freeze({
  status: 'idle',
  level: 0,
  durationMs: 0,
  clip: null,
  transcript: null,
  error: null,
})

/** Normalize browser exceptions without leaking device-specific text to copy. */
function errorCode(error: unknown): VoiceCaptureErrorCode {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'device-busy'
  if (name === 'NotSupportedError') return 'unsupported'
  if (name === 'VoiceTranscriberUnavailableError') return 'transcription-unavailable'
  if (name === 'VoiceTranscriptionFailedError') return 'transcription-failed'
  return 'capture-failed'
}

/** Local-first microphone controller with silence and duration guards. */
export class VoiceCaptureController implements HostObservable<VoiceCaptureView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly pollMs: number
  private readonly silenceMs: number
  private readonly speechThreshold: number
  private readonly maximumMs: number
  private readonly transcribe: VoiceTranscriber | undefined
  private active: ActiveVoiceCapture | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private startedAt = 0
  private speechSeen = false
  private silentSince: number | null = null
  private generation = 0
  private finishPromise: Promise<void> | null = null
  private disposed = false

  constructor(
    private readonly driver: VoiceCaptureDriver,
    options: VoiceCaptureControllerOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now())
    this.pollMs = options.pollMs ?? 80
    this.silenceMs = options.silenceMs ?? 1_400
    this.speechThreshold = options.speechThreshold ?? 0.08
    this.maximumMs = options.maximumMs ?? 60_000
    this.transcribe = options.transcribe
  }

  /** Return the cached immutable snapshot. */
  getSnapshot = (): VoiceCaptureView => this.view

  /** Subscribe to snapshot replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Ask for the microphone and begin measuring it. */
  async start(): Promise<void> {
    if (this.disposed || this.view.status === 'requesting'
      || this.view.status === 'listening' || this.view.status === 'processing') return
    const generation = ++this.generation
    this.publish({ ...INITIAL_VIEW, status: 'requesting' })
    try {
      const active = await this.driver.begin()
      // dispose()/cancel() may run while the browser permission promise waits.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- asynchronous lifetime guard.
      if (this.disposed || generation !== this.generation) {
        active.cancel()
        return
      }
      this.active = active
      this.startedAt = this.now()
      this.speechSeen = false
      this.silentSince = null
      this.publish({ ...INITIAL_VIEW, status: 'listening' })
      this.poll = setInterval(() => { this.sample(generation) }, this.pollMs)
    } catch (error) {
      // dispose()/cancel() may run while the browser permission promise waits.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- asynchronous lifetime guard.
      if (this.disposed || generation !== this.generation) return
      this.publish({ ...INITIAL_VIEW, status: 'error', error: errorCode(error) })
    }
  }

  /** Stop normally, then optionally pass the private clip to a transcriber. */
  finish(): Promise<void> {
    if (this.finishPromise !== null) return this.finishPromise
    const active = this.active
    if (active === null) return Promise.resolve()
    const generation = this.generation
    this.active = null
    this.clearPoll()
    this.publish({ ...this.view, status: 'processing', level: 0, error: null })
    const settle = async (): Promise<void> => {
      try {
        const clip = await active.finish()
        if (this.disposed || generation !== this.generation) return
        const summary: VoiceClipSummary = {
          bytes: clip.bytes,
          durationMs: clip.durationMs,
          mimeType: clip.mimeType,
        }
        if (clip.bytes === 0) {
          this.publish({ ...INITIAL_VIEW, status: 'error', clip: summary, error: 'empty-audio' })
          return
        }
        if (this.transcribe === undefined) {
          this.publish({ ...INITIAL_VIEW, status: 'captured', clip: summary })
          return
        }
        const transcript = (await this.transcribe(clip)).trim()
        // dispose()/cancel() may run while the provider promise waits.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- asynchronous lifetime guard.
        if (this.disposed || generation !== this.generation) return
        if (transcript.length === 0) {
          this.publish({ ...INITIAL_VIEW, status: 'error', clip: summary, error: 'no-speech' })
          return
        }
        this.publish({
          ...INITIAL_VIEW,
          status: 'transcribed',
          clip: summary,
          transcript,
        })
      } catch (error) {
        if (this.disposed || generation !== this.generation) return
        this.publish({ ...INITIAL_VIEW, status: 'error', error: errorCode(error) })
      }
    }
    const pending = settle().finally(() => {
      if (this.finishPromise === pending) this.finishPromise = null
    })
    this.finishPromise = pending
    return pending
  }

  /** Cancel the active capture and return to the resting state. */
  cancel(): void {
    if (this.disposed) return
    this.generation += 1
    this.clearPoll()
    this.active?.cancel()
    this.active = null
    this.publish(INITIAL_VIEW)
  }

  /**
   * Retire a transcript after the component writes it into the ordinary draft.
   * @param transcript - exact recognized text currently published by the view.
   */
  acknowledgeTranscript(transcript: string): void {
    if (this.view.status !== 'transcribed' || this.view.transcript !== transcript) return
    this.publish(INITIAL_VIEW)
  }

  /** End the slot lifetime; late permissions and recordings become silent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.clearPoll()
    this.active?.cancel()
    this.active = null
    this.listeners.clear()
  }

  /** Poll level and enforce silence / maximum-duration policy. */
  private sample(generation: number): void {
    if (generation !== this.generation || this.active === null || this.view.status !== 'listening') return
    const now = this.now()
    const durationMs = Math.max(0, now - this.startedAt)
    let level: number
    try {
      level = Math.max(0, Math.min(1, this.active.level()))
    } catch {
      this.active.cancel()
      this.active = null
      this.clearPoll()
      this.publish({ ...INITIAL_VIEW, status: 'error', error: 'capture-failed' })
      return
    }
    this.publish({ ...this.view, level, durationMs })

    if (level >= this.speechThreshold) {
      this.speechSeen = true
      this.silentSince = null
    } else if (this.speechSeen) {
      this.silentSince ??= now
    }

    if (durationMs >= this.maximumMs
      || (this.silentSince !== null && now - this.silentSince >= this.silenceMs)) {
      void this.finish()
    }
  }

  private clearPoll(): void {
    if (this.poll === null) return
    clearInterval(this.poll)
    this.poll = null
  }

  /** Replace the view and contain subscriber failures at the observable edge. */
  private publish(view: VoiceCaptureView): void {
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-voice] subscriber threw:', error)
      }
    }
  }
}
