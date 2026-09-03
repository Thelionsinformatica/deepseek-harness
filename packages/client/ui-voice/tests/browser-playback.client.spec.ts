// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserVoicePlaybackDriver, selectLocalVoice, VoicePlaybackFailedError,
  VoicePlaybackUnavailableError,
} from '../src/client/browser-playback.ts'

afterEach(() => { vi.useRealTimers() })

function voice(name: string, lang: string, localService: boolean): SpeechSynthesisVoice {
  return { name, lang, localService, default: false, voiceURI: name }
}

describe('BrowserVoicePlaybackDriver', () => {
  it('prefers the installed Brazilian Portuguese voice and rejects remote-only catalogs', () => {
    const remote = voice('Remote', 'pt-BR', false)
    const maria = voice('Microsoft Maria', 'pt-BR', true)
    const daniel = voice('Microsoft Daniel - Portuguese (Brazil)', 'pt-BR', true)
    expect(selectLocalVoice([remote, maria, daniel])?.name).toBe(daniel.name)
    expect(selectLocalVoice([remote])).toBeNull()
  })

  it('plays with the selected local voice', async () => {
    const daniel = voice('Microsoft Daniel', 'pt-BR', true)
    const utterance = {} as SpeechSynthesisUtterance
    const speak = vi.fn((spoken: SpeechSynthesisUtterance): void => {
      queueMicrotask(() => { spoken.onend?.(new Event('end') as SpeechSynthesisEvent) })
    })
    const synthesis = {
      getVoices: () => [daniel],
      speak,
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis
    const driver = new BrowserVoicePlaybackDriver(synthesis, {
      createUtterance: () => utterance,
    })

    await expect(driver.speak('Bom dia', new AbortController().signal)).resolves.toEqual({
      voiceName: 'Microsoft Daniel',
    })
    expect(utterance.voice).toBe(daniel)
    expect(speak).toHaveBeenCalledWith(utterance)
  })

  it('fails closed when the browser only exposes a remote voice', async () => {
    const speak = vi.fn()
    const synthesis = {
      getVoices: () => [voice('Remote', 'pt-BR', false)],
      speak, cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis
    const driver = new BrowserVoicePlaybackDriver(synthesis)

    await expect(driver.speak('não enviar', new AbortController().signal)).rejects.toBeInstanceOf(
      VoicePlaybackUnavailableError,
    )
    expect(speak).not.toHaveBeenCalled()
  })

  it('cancels playback that never settles instead of hanging forever', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const synthesis = {
      getVoices: () => [voice('Microsoft Daniel', 'pt-BR', true)],
      speak: vi.fn(), cancel, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis
    const driver = new BrowserVoicePlaybackDriver(synthesis, {
      playbackTimeoutMs: 25,
      createUtterance: () => ({} as SpeechSynthesisUtterance),
    })
    const pending = driver.speak('sem evento final', new AbortController().signal)
    const assertion = expect(pending).rejects.toBeInstanceOf(VoicePlaybackFailedError)

    await vi.advanceTimersByTimeAsync(25)

    await assertion
    expect(cancel).toHaveBeenCalledOnce()
  })
})
