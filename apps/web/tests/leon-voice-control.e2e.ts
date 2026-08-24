/** The assembled Leon Web composition exposes truthful browser voice capture. */

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import {
  connectFreshWorkspace, newEnglishPage, saveFailureShot,
} from './support.ts'

describe('web e2e: Leon voice control', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.route('**/api/leon/voice/transcribe', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'hello from Leon voice' }),
      })
    })
    await page.addInitScript(() => {
      const state = globalThis as typeof globalThis & { __leonVoiceTracksStopped?: number }
      state.__leonVoiceTracksStopped = 0

      class FakeRecorder extends EventTarget {
        static isTypeSupported(): boolean { return true }
        state: RecordingState = 'inactive'
        readonly mimeType = 'audio/webm;codecs=opus'
        constructor(_stream: MediaStream, _options?: MediaRecorderOptions) { super() }
        start(): void { this.state = 'recording' }
        requestData(): void {
          this.dispatchEvent(new BlobEvent('dataavailable', {
            data: new Blob(['voice'], { type: this.mimeType }),
          }))
        }
        stop(): void {
          if (this.state === 'inactive') return
          this.state = 'inactive'
          queueMicrotask(() => { this.dispatchEvent(new Event('stop')) })
        }
      }

      class FakeAudioContext {
        readonly state = 'running'
        resume(): Promise<void> { return Promise.resolve() }
        close(): Promise<void> { return Promise.resolve() }
        createMediaStreamSource(): MediaStreamAudioSourceNode {
          return {
            connect: () => undefined,
            disconnect: () => undefined,
          } as unknown as MediaStreamAudioSourceNode
        }
        createAnalyser(): AnalyserNode {
          return {
            fftSize: 256,
            smoothingTimeConstant: 0,
            getByteTimeDomainData: (values: Uint8Array) => {
              values.fill(128)
              values[0] = 156
            },
          } as unknown as AnalyserNode
        }
      }

      const track = { stop: () => { state.__leonVoiceTracksStopped = (state.__leonVoiceTracksStopped ?? 0) + 1 } }
      const stream = { getTracks: () => [track] } as unknown as MediaStream
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => stream },
      })
      Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder })
      Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'leon-voice')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('transcribes, submits through chat, and releases the microphone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-leon-voice-control'))
    const start = page.getByRole('button', { name: 'Start voice' })
    await start.waitFor({ timeout: 30_000 })
    await start.click()

    await page.getByRole('status').filter({ hasText: 'Leon is listening' }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect.poll(() => scaffold.ctx.sessions.list().some(session => session.events.some(event => (
      event.type === 'user/message'
      && JSON.stringify(event.data.content).includes('hello from Leon voice')
    ))), { timeout: 10_000 }).toBe(true)
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __leonVoiceTracksStopped?: number }
    ).__leonVoiceTracksStopped)).toBe(1)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
