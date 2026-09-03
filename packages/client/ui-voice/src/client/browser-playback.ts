/** Local-only speech playback through the browser's operating-system voices. */

/** Successful playback metadata retained by the controller. */
export interface VoicePlaybackReceipt {
  readonly voiceName: string
}

/** Replaceable speech provider used by the playback state machine. */
export interface VoicePlaybackDriver {
  speak: (text: string, signal: AbortSignal) => Promise<VoicePlaybackReceipt>
}

/** Browser policy for deterministic local voice selection. */
export interface BrowserVoicePlaybackOptions {
  readonly language?: string
  readonly preferredVoiceNames?: readonly string[]
  readonly voiceWaitMs?: number
  readonly playbackTimeoutMs?: number
  readonly createUtterance?: (text: string) => SpeechSynthesisUtterance
}

/** Stable provider failure used when no browser-local voice is available. */
export class VoicePlaybackUnavailableError extends Error {
  override name = 'VoicePlaybackUnavailableError'
}

/** Stable provider failure used when the browser cannot finish playback. */
export class VoicePlaybackFailedError extends Error {
  override name = 'VoicePlaybackFailedError'
}

const DEFAULT_LANGUAGE = 'pt-BR'
const DEFAULT_PREFERRED_VOICES = ['Microsoft Daniel']

/**
 * Pick a local voice without allowing an undisclosed network synthesizer.
 *
 * @param voices Browser voices currently available to the page.
 * @param language Preferred BCP 47 language tag.
 * @param preferredVoiceNames Ordered voice-name fragments to prefer.
 * @returns The best local match, or `null` when no local voice exists.
 */
export function selectLocalVoice(
  voices: readonly SpeechSynthesisVoice[],
  language = DEFAULT_LANGUAGE,
  preferredVoiceNames: readonly string[] = DEFAULT_PREFERRED_VOICES,
): SpeechSynthesisVoice | null {
  const local = voices.filter(voice => voice.localService)
  if (local.length === 0) return null
  const requested = language.toLocaleLowerCase()
  const base = requested.split('-')[0] ?? requested
  const exact = local.filter(voice => voice.lang.toLocaleLowerCase() === requested)
  const family = local.filter(voice => voice.lang.toLocaleLowerCase().split('-')[0] === base)
  const candidates = exact.length > 0 ? exact : family.length > 0 ? family : local
  for (const preferred of preferredVoiceNames) {
    const match = candidates.find(voice => voice.name.toLocaleLowerCase().includes(
      preferred.toLocaleLowerCase(),
    ))
    if (match !== undefined) return match
  }
  return candidates[0] ?? null
}

/** Browser speech driver that rejects cloud voices and supports immediate abort. */
export class BrowserVoicePlaybackDriver implements VoicePlaybackDriver {
  private readonly language: string
  private readonly preferredVoiceNames: readonly string[]
  private readonly voiceWaitMs: number
  private readonly playbackTimeoutMs: number
  private readonly createUtterance: (text: string) => SpeechSynthesisUtterance

  constructor(
    private readonly synthesis: SpeechSynthesis | undefined = globalThis.speechSynthesis,
    options: BrowserVoicePlaybackOptions = {},
  ) {
    this.language = options.language ?? DEFAULT_LANGUAGE
    this.preferredVoiceNames = options.preferredVoiceNames ?? DEFAULT_PREFERRED_VOICES
    this.voiceWaitMs = options.voiceWaitMs ?? 400
    this.playbackTimeoutMs = options.playbackTimeoutMs ?? 180_000
    this.createUtterance = options.createUtterance ?? (text => new SpeechSynthesisUtterance(text))
  }

  async speak(text: string, signal: AbortSignal): Promise<VoicePlaybackReceipt> {
    const synthesis = this.synthesis
    if (synthesis === undefined) {
      throw new VoicePlaybackUnavailableError('speech synthesis is unavailable')
    }
    const voices = await this.readVoices(synthesis, signal)
    if (signal.aborted) return { voiceName: '' }
    const voice = selectLocalVoice(voices, this.language, this.preferredVoiceNames)
    if (voice === null) {
      throw new VoicePlaybackUnavailableError('no browser-local voice is available')
    }

    let utterance: SpeechSynthesisUtterance
    try {
      utterance = this.createUtterance(text)
    } catch (cause) {
      throw new VoicePlaybackUnavailableError('speech utterances are unavailable', { cause })
    }
    utterance.lang = voice.lang
    utterance.voice = voice

    return await new Promise<VoicePlaybackReceipt>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        synthesis.cancel()
        settle(new VoicePlaybackFailedError('speech synthesis timed out'))
      }, this.playbackTimeoutMs)
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        utterance.onend = null
        utterance.onerror = null
        if (error === undefined) resolve({ voiceName: voice.name })
        else reject(error)
      }
      const onAbort = (): void => {
        synthesis.cancel()
        settle()
      }
      utterance.onend = () => { settle() }
      utterance.onerror = (event) => {
        if (signal.aborted || event.error === 'canceled' || event.error === 'interrupted') {
          settle()
          return
        }
        settle(new VoicePlaybackFailedError(`speech synthesis failed: ${event.error}`))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
      try {
        synthesis.speak(utterance)
      } catch (cause) {
        settle(new VoicePlaybackFailedError('speech synthesis failed to start', { cause }))
      }
    })
  }

  /** Wait briefly for Chromium's asynchronous voice catalog, then stay fail-closed. */
  private async readVoices(
    synthesis: SpeechSynthesis,
    signal: AbortSignal,
  ): Promise<readonly SpeechSynthesisVoice[]> {
    const initial = synthesis.getVoices()
    if (initial.length > 0 || this.voiceWaitMs <= 0 || signal.aborted) return initial
    return await new Promise<readonly SpeechSynthesisVoice[]>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        synthesis.removeEventListener('voiceschanged', onVoicesChanged)
        signal.removeEventListener('abort', onAbort)
        resolve(synthesis.getVoices())
      }
      const onVoicesChanged = (): void => { finish() }
      const onAbort = (): void => { finish() }
      const timer = setTimeout(finish, this.voiceWaitMs)
      synthesis.addEventListener('voiceschanged', onVoicesChanged, { once: true })
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
