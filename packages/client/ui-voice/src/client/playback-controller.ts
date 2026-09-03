/** Observable state machine for one interruptible spoken response. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoicePlaybackDriver } from './browser-playback.ts'

/** Visible speech playback phases. */
export type VoicePlaybackStatus = 'idle' | 'speaking' | 'interrupted' | 'error'

/** Stable speech failures translated by the presentation layer. */
export type VoicePlaybackErrorCode = 'unsupported' | 'no-local-voice' | 'playback-failed'

/** Immutable playback view consumed by the composer and activity HUD. */
export interface VoicePlaybackView {
  readonly status: VoicePlaybackStatus
  readonly text: string | null
  readonly voiceName: string | null
  readonly error: VoicePlaybackErrorCode | null
}

const INITIAL_VIEW: VoicePlaybackView = Object.freeze({
  status: 'idle',
  text: null,
  voiceName: null,
  error: null,
})

function playbackError(error: unknown): VoicePlaybackErrorCode {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : ''
  if (name === 'VoicePlaybackUnavailableError') return 'no-local-voice'
  if (name === 'NotSupportedError') return 'unsupported'
  return 'playback-failed'
}

/** Own one replaceable playback operation and stop it without cancelling the agent. */
export class VoicePlaybackController implements HostObservable<VoicePlaybackView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private active: AbortController | null = null
  private generation = 0
  private disposed = false

  constructor(private readonly driver: VoicePlaybackDriver) {}

  getSnapshot = (): VoicePlaybackView => this.view

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Speak one non-empty answer, replacing any older audio from this controller.
   *
   * @param text Finalized assistant prose to synthesize.
   */
  async speak(text: string): Promise<void> {
    const normalized = text.trim()
    if (this.disposed || normalized.length === 0) return
    this.active?.abort()
    const generation = ++this.generation
    const active = new AbortController()
    this.active = active
    this.publish({ status: 'speaking', text: normalized, voiceName: null, error: null })
    try {
      const receipt = await this.driver.speak(normalized, active.signal)
      // dispose()/interrupt()/replacement may run while browser playback waits.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- asynchronous lifetime guard.
      if (this.disposed || generation !== this.generation) return
      this.active = null
      this.publish({ ...INITIAL_VIEW, voiceName: receipt.voiceName || null })
    } catch (error) {
      // dispose()/interrupt()/replacement may run while browser playback waits.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- asynchronous lifetime guard.
      if (this.disposed || generation !== this.generation || active.signal.aborted) return
      this.active = null
      this.publish({ status: 'error', text: normalized, voiceName: null, error: playbackError(error) })
    }
  }

  /** Stop only audio playback; the session task and tools continue running. */
  interrupt(): void {
    if (this.disposed || this.active === null) return
    const text = this.view.text
    this.generation += 1
    this.active.abort()
    this.active = null
    this.publish({ status: 'interrupted', text, voiceName: null, error: null })
  }

  /** Stop audio silently when its owning session leaves the screen. */
  stop(): void {
    if (this.disposed) return
    this.generation += 1
    this.active?.abort()
    this.active = null
    this.publish(INITIAL_VIEW)
  }

  /** Release the browser speech lifetime and silence late callbacks. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.active?.abort()
    this.active = null
    this.listeners.clear()
  }

  private publish(view: VoicePlaybackView): void {
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-voice] playback subscriber threw:', error)
      }
    }
  }
}
