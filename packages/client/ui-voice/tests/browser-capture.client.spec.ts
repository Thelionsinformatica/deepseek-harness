// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceCaptureDriver } from '../src/client/browser-capture.ts'

interface FakeOptions {
  readonly disconnectThrows?: boolean
  readonly requestThrows?: boolean
  readonly stopThrows?: boolean
}

function installBrowserFakes(options: FakeOptions = {}) {
  const stopTrack = vi.fn()
  const disconnect = vi.fn(() => {
    if (options.disconnectThrows === true) throw new Error('disconnect failed')
  })
  const close = vi.fn(async () => undefined)
  const recorders: Recorder[] = []

  class Recorder extends EventTarget {
    static isTypeSupported(): boolean { return true }
    state: RecordingState = 'inactive'
    mimeType = 'audio/webm'
    constructor() {
      super()
      recorders.push(this)
    }
    start(): void { this.state = 'recording' }
    requestData(): void {
      if (options.requestThrows === true) throw new Error('recorder failed')
    }
    stop(): void {
      if (options.stopThrows === true) throw new Error('stop failed')
      this.state = 'inactive'
      this.dispatchEvent(new Event('stop'))
    }
  }
  class Audio {
    state: AudioContextState = 'running'
    resume = vi.fn(async () => undefined)
    close = close
    createMediaStreamSource(): MediaStreamAudioSourceNode {
      return { connect: vi.fn(), disconnect } as unknown as MediaStreamAudioSourceNode
    }
    createAnalyser(): AnalyserNode {
      return {
        fftSize: 256,
        smoothingTimeConstant: 0,
        getByteTimeDomainData: vi.fn(),
      } as unknown as AnalyserNode
    }
  }
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  })
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', Audio)
  return {
    close,
    disconnect,
    driver: new BrowserVoiceCaptureDriver(() => 10),
    recorder: () => recorders[0] ?? null,
    stopTrack,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('BrowserVoiceCaptureDriver resource lifetime', () => {
  it('releases tracks and audio resources when recorder finalization throws', async () => {
    const fixture = installBrowserFakes({ requestThrows: true })
    const active = await fixture.driver.begin()

    await expect(active.finish()).rejects.toThrow('recorder failed')

    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
  })

  it('contains a throwing recorder stop while cancellation releases resources', async () => {
    const fixture = installBrowserFakes({ stopThrows: true })
    const active = await fixture.driver.begin()

    expect(() => { active.cancel() }).not.toThrow()

    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
  })

  it('releases resources immediately after a spontaneous recorder error', async () => {
    const fixture = installBrowserFakes()
    await fixture.driver.begin()
    const event = new Event('error') as Event & { error?: DOMException }
    event.error = new DOMException('device failed')

    fixture.recorder()?.dispatchEvent(event)

    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
  })

  it('still stops the microphone when the Web Audio disconnect throws', async () => {
    const fixture = installBrowserFakes({ disconnectThrows: true })
    const active = await fixture.driver.begin()

    active.cancel()

    expect(fixture.disconnect).toHaveBeenCalledOnce()
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
  })
})
