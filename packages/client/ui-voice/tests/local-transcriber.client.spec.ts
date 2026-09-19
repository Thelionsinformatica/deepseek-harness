import { describe, expect, it, vi } from 'vitest'
import type { VoiceAudioClip } from '../src/client/browser-capture.ts'
import {
  createLocalVoiceTranscriber, LOCAL_VOICE_TRANSCRIPTION_PATH,
} from '../src/client/local-transcriber.ts'

const clip: VoiceAudioClip = {
  blob: new Blob(['voice'], { type: 'audio/webm;codecs=opus' }),
  bytes: 5,
  durationMs: 800,
  mimeType: 'audio/webm;codecs=opus',
}

describe('local voice transcriber', () => {
  it('sends the private clip to the same-origin route and returns text', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ text: 'bom dia Leon' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const transcribe = createLocalVoiceTranscriber(request)
    const signal = new AbortController().signal

    await expect(transcribe(clip, signal)).resolves.toBe('bom dia Leon')
    expect(request).toHaveBeenCalledWith(LOCAL_VOICE_TRANSCRIPTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      body: clip.blob,
      signal,
    })
  })

  it.each([
    [503, 'VoiceTranscriberUnavailableError'],
    [500, 'VoiceTranscriptionFailedError'],
  ] as const)('normalizes HTTP %s into %s', async (status, name) => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'FAILURE', message: 'offline worker failed' },
    }), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
    const transcribe = createLocalVoiceTranscriber(request)

    await expect(transcribe(clip, new AbortController().signal)).rejects.toMatchObject({
      name,
      message: 'offline worker failed',
    })
  })

  it('forwards in-flight cancellation without normalizing its reason as a provider failure', async () => {
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined) throw new Error('missing request signal')
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('request aborted'))
        }, { once: true })
      })
    ))
    const transcribe = createLocalVoiceTranscriber(request)
    const controller = new AbortController()
    const pending = transcribe(clip, controller.signal)
    const reason = new Error('session changed')

    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(request.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('rejects a late response after cancellation even when the request ignores its signal', async () => {
    let answer!: (response: Response) => void
    const request = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve }))
    const transcribe = createLocalVoiceTranscriber(request)
    const controller = new AbortController()
    const pending = transcribe(clip, controller.signal)
    const reason = new Error('capture cancelled')

    controller.abort(reason)
    answer(new Response(JSON.stringify({ text: 'late text' }), { status: 200 }))

    await expect(pending).rejects.toBe(reason)
  })
})
