/** Same-origin adapter for Leon's offline speech-to-text route. */

import type { VoiceAudioClip } from './browser-capture.ts'
import type { VoiceTranscriber } from './controller.ts'

/** Host route registered by the Web application bundle. */
export const LOCAL_VOICE_TRANSCRIPTION_PATH = '/api/leon/voice/transcribe'

interface TranscriptionResponse {
  text?: unknown
  error?: { code?: unknown; message?: unknown }
}

/** Error name consumed by the controller's stable localization mapping. */
function unavailable(message: string): Error {
  const error = new Error(message)
  error.name = 'VoiceTranscriberUnavailableError'
  return error
}

/** Error name for a configured transcriber that could not process one clip. */
function failed(message: string): Error {
  const error = new Error(message)
  error.name = 'VoiceTranscriptionFailedError'
  return error
}

/**
 * Build a transcriber that uploads one ephemeral clip to Leon's loopback host.
 * @param request - injectable Fetch implementation.
 * @param endpoint - same-origin route path.
 * @returns controller-compatible local transcription callback.
 */
export function createLocalVoiceTranscriber(
  request: typeof fetch = fetch,
  endpoint: string = LOCAL_VOICE_TRANSCRIPTION_PATH,
): VoiceTranscriber {
  return async (clip: VoiceAudioClip): Promise<string> => {
    let response: Response
    try {
      response = await request(endpoint, {
        method: 'POST',
        headers: { 'content-type': clip.mimeType },
        body: clip.blob,
      })
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : String(error))
    }
    let body: TranscriptionResponse
    try {
      body = await response.json() as TranscriptionResponse
    } catch {
      throw failed('The local transcriber returned invalid JSON.')
    }
    if (!response.ok) {
      const message = typeof body.error?.message === 'string'
        ? body.error.message
        : `Local transcription failed with HTTP ${String(response.status)}.`
      if (response.status === 503 || response.status === 504) throw unavailable(message)
      throw failed(message)
    }
    if (typeof body.text !== 'string') throw failed('The local transcriber returned no text field.')
    return body.text
  }
}
