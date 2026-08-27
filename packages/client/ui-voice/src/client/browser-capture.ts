/** Browser adapter that keeps MediaStream details out of the voice controller. */

/** One ephemeral recording produced by the browser. */
export interface VoiceAudioClip {
  readonly blob: Blob
  readonly bytes: number
  readonly durationMs: number
  readonly mimeType: string
}

/** Active microphone session controlled by the state machine. */
export interface ActiveVoiceCapture {
  /** Current normalized microphone energy, in the inclusive range 0..1. */
  level(): number
  /** Stop normally and settle the complete recording. */
  finish(): Promise<VoiceAudioClip>
  /** Stop immediately and discard the recording. */
  cancel(): void
}

/** Factory seam used by the controller and substituted by deterministic tests. */
export interface VoiceCaptureDriver {
  begin(): Promise<ActiveVoiceCapture>
}

/** Media types ordered by quality and browser support. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

/** Choose a recorder format without forcing an unsupported constructor option. */
function preferredMimeType(Recorder: typeof MediaRecorder): string | undefined {
  return MIME_CANDIDATES.find(type => Recorder.isTypeSupported(type))
}

/** One resource-owning browser capture. */
class BrowserActiveVoiceCapture implements ActiveVoiceCapture {
  private readonly chunks: Blob[] = []
  private readonly values: Uint8Array<ArrayBuffer>
  private readonly stopped: Promise<void>
  private resolveStopped!: () => void
  private rejectStopped!: (error: Error) => void
  private released = false
  private cancelled = false

  constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly analyser: AnalyserNode,
    private readonly startedAt: number,
    private readonly now: () => number,
  ) {
    this.values = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    this.stopped = new Promise<void>((resolve, reject) => {
      this.resolveStopped = resolve
      this.rejectStopped = reject
    })
    recorder.addEventListener('dataavailable', this.onData)
    recorder.addEventListener('stop', this.onStop, { once: true })
    recorder.addEventListener('error', this.onError, { once: true })
  }

  /** Start chunked recording after all handlers are installed. */
  start(): void {
    this.recorder.start(250)
  }

  level(): number {
    if (this.released) return 0
    this.analyser.getByteTimeDomainData(this.values)
    let power = 0
    for (const value of this.values) {
      const normalized = (value - 128) / 128
      power += normalized * normalized
    }
    // Ordinary speech has a small raw RMS. Scaling makes the UI meter useful
    // while the clamp keeps the controller independent of device gain.
    return Math.min(1, Math.sqrt(power / this.values.length) * 4)
  }

  async finish(): Promise<VoiceAudioClip> {
    if (this.cancelled) throw new Error('voice capture was cancelled')
    if (this.recorder.state === 'recording') {
      this.recorder.requestData()
      this.recorder.stop()
    }
    await this.stopped
    const durationMs = Math.max(0, this.now() - this.startedAt)
    const mimeType = this.recorder.mimeType || this.chunks[0]?.type || 'application/octet-stream'
    const blob = new Blob(this.chunks, { type: mimeType })
    this.release()
    return { blob, bytes: blob.size, durationMs, mimeType }
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    if (this.recorder.state === 'recording') this.recorder.stop()
    this.release()
    // A recorder error after cancellation is intentionally contained: no
    // consumer remains to observe this recording.
    void this.stopped.catch(() => undefined)
  }

  private readonly onData = (event: BlobEvent): void => {
    if (!this.cancelled && event.data.size > 0) this.chunks.push(event.data)
  }

  private readonly onStop = (): void => {
    this.resolveStopped()
  }

  private readonly onError = (event: Event): void => {
    const detail = (event as Event & { error?: DOMException }).error
    this.rejectStopped(detail ?? new Error('microphone recorder failed'))
  }

  /** Release every browser resource exactly once. */
  private release(): void {
    if (this.released) return
    this.released = true
    this.recorder.removeEventListener('dataavailable', this.onData)
    this.source.disconnect()
    for (const track of this.stream.getTracks()) track.stop()
    void this.context.close().catch(() => undefined)
  }
}

/** Production driver backed by getUserMedia, MediaRecorder, and Web Audio. */
export class BrowserVoiceCaptureDriver implements VoiceCaptureDriver {
  constructor(private readonly now: () => number = () => performance.now()) {}

  async begin(): Promise<ActiveVoiceCapture> {
    const browserNavigator = navigator as unknown as {
      mediaDevices?: { getUserMedia?: MediaDevices['getUserMedia'] }
    }
    const browserGlobals = globalThis as unknown as {
      AudioContext?: typeof AudioContext
      MediaRecorder?: typeof MediaRecorder
    }
    if (browserNavigator.mediaDevices?.getUserMedia === undefined) {
      const error = new Error('microphone capture is not supported')
      error.name = 'NotSupportedError'
      throw error
    }
    const Recorder = browserGlobals.MediaRecorder
    const Audio = browserGlobals.AudioContext
    if (Recorder === undefined || Audio === undefined) {
      const error = new Error('audio recording is not supported')
      error.name = 'NotSupportedError'
      throw error
    }

    const stream = await browserNavigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    })

    let context: AudioContext | undefined
    try {
      const mimeType = preferredMimeType(Recorder)
      const recorder = mimeType === undefined
        ? new Recorder(stream)
        : new Recorder(stream, { mimeType })
      context = new Audio()
      if (context.state === 'suspended') await context.resume()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)
      const active = new BrowserActiveVoiceCapture(
        stream, recorder, context, source, analyser, this.now(), this.now,
      )
      active.start()
      return active
    } catch (error) {
      for (const track of stream.getTracks()) track.stop()
      if (context !== undefined) void context.close().catch(() => undefined)
      throw error
    }
  }
}
