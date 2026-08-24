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
    const transcribe = createLocalVoiceTranscriber(request as typeof fetch)

    await expect(transcribe(clip)).resolves.toBe('bom dia Leon')
    expect(request).toHaveBeenCalledWith(LOCAL_VOICE_TRANSCRIPTION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      body: clip.blob,
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
    const transcribe = createLocalVoiceTranscriber(request as typeof fetch)

    await expect(transcribe(clip)).rejects.toMatchObject({ name, message: 'offline worker failed' })
  })
})
