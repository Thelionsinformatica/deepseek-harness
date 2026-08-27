import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveVoiceCapture, VoiceAudioClip, VoiceCaptureDriver,
} from '../src/client/browser-capture.ts'
import { VoiceCaptureController } from '../src/client/controller.ts'

function audioClip(bytes = 3): VoiceAudioClip {
  const blob = new Blob([bytes === 0 ? '' : 'ola'], { type: 'audio/webm' })
  return { blob, bytes, durationMs: 1_250, mimeType: 'audio/webm' }
}

class FakeCapture implements ActiveVoiceCapture {
  currentLevel = 0
  readonly finish = vi.fn(async () => audioClip())
  readonly cancel = vi.fn()
  level(): number { return this.currentLevel }
}

describe('VoiceCaptureController', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('publishes request, listening, live level, and captured states', async () => {
    let now = 10
    const capture = new FakeCapture()
    const driver: VoiceCaptureDriver = { begin: vi.fn(async () => capture) }
    const controller = new VoiceCaptureController(driver, { now: () => now })
    const states: string[] = []
    controller.subscribe(() => { states.push(controller.getSnapshot().status) })

    await controller.start()
    expect(controller.getSnapshot().status).toBe('listening')
    capture.currentLevel = 0.42
    now = 90
    await vi.advanceTimersByTimeAsync(80)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'listening', level: 0.42, durationMs: 80,
    })

    await controller.finish()
    expect(capture.finish).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      status: 'captured',
      clip: { bytes: 3, durationMs: 1_250, mimeType: 'audio/webm' },
    })
    expect(states).toContain('requesting')
    expect(states).toContain('processing')
  })

  it('maps permission refusal to a stable presentation code', async () => {
    const denied = new Error('browser-specific message')
    denied.name = 'NotAllowedError'
    const controller = new VoiceCaptureController({
      begin: vi.fn(async () => { throw denied }),
    })

    await controller.start()

    expect(controller.getSnapshot()).toMatchObject({
      status: 'error', error: 'permission-denied',
    })
  })

  it('stops after speech followed by configured silence', async () => {
    let now = 0
    const capture = new FakeCapture()
    const controller = new VoiceCaptureController(
      { begin: vi.fn(async () => capture) },
      { now: () => now, pollMs: 80, silenceMs: 1_400 },
    )
    await controller.start()

    capture.currentLevel = 0.4
    now = 100
    await vi.advanceTimersByTimeAsync(80)
    capture.currentLevel = 0
    now = 200
    await vi.advanceTimersByTimeAsync(80)
    now = 1_650
    await vi.advanceTimersByTimeAsync(80)

    expect(capture.finish).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().status).toBe('captured')
  })

  it('stops a late microphone grant after the slot has been disposed', async () => {
    const capture = new FakeCapture()
    let grant!: (active: ActiveVoiceCapture) => void
    const pending = new Promise<ActiveVoiceCapture>((resolve) => { grant = resolve })
    const controller = new VoiceCaptureController({ begin: () => pending })

    const start = controller.start()
    controller.dispose()
    grant(capture)
    await start

    expect(capture.cancel).toHaveBeenCalledOnce()
  })

  it('exposes only recognized text when an optional transcriber is installed', async () => {
    const capture = new FakeCapture()
    const transcribe = vi.fn(async () => '  bom dia Leon  ')
    const controller = new VoiceCaptureController(
      { begin: vi.fn(async () => capture) },
      { transcribe },
    )
    await controller.start()
    await controller.finish()

    expect(transcribe).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      status: 'transcribed', transcript: 'bom dia Leon',
    })
    controller.acknowledgeTranscript('bom dia Leon')
    expect(controller.getSnapshot().status).toBe('idle')
  })
})
