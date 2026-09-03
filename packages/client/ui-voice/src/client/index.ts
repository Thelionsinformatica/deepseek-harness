/** Register Leon's local-first microphone control in the composer. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrowserVoiceCaptureDriver } from './browser-capture.ts'
import { BrowserVoicePlaybackDriver } from './browser-playback.ts'
import { VoiceCaptureController } from './controller.ts'
import { createLocalVoiceTranscriber } from './local-transcriber.ts'
import { en, NS, pt, zh, type VoiceKey } from './locales.ts'
import { VoicePlaybackController } from './playback-controller.ts'
import { VoiceActivity, type VoiceActivityInjected } from './VoiceActivity.tsx'
import {
  VoiceControl, type VoiceControlInjected,
} from './VoiceControl.tsx'

export type {
  ActiveVoiceCapture, VoiceAudioClip, VoiceCaptureDriver,
} from './browser-capture.ts'
export type {
  VoiceCaptureControllerOptions, VoiceCaptureErrorCode, VoiceCaptureStatus,
  VoiceCaptureView, VoiceClipSummary, VoiceTranscriber,
} from './controller.ts'
export { BrowserVoiceCaptureDriver } from './browser-capture.ts'
export { VoiceCaptureController } from './controller.ts'
export { createLocalVoiceTranscriber, LOCAL_VOICE_TRANSCRIPTION_PATH } from './local-transcriber.ts'
export type { VoiceControlInjected, VoiceControlProps } from './VoiceControl.tsx'
export type { VoiceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Leon voice-control copy. */
    voice: VoiceKey
  }
}

/** Required services: composer seat and locale registry. */
export const inject = ['slots', 'locale']

/** Register shared capture/playback lifetimes and their two conversation surfaces. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { pt, zh, en }), 'ui-voice: dictionaries')
  const capture = new VoiceCaptureController(new BrowserVoiceCaptureDriver(), {
    transcribe: createLocalVoiceTranscriber(),
  })
  const playback = new VoicePlaybackController(new BrowserVoicePlaybackDriver())
  ctx.effect(() => () => {
    playback.dispose()
    capture.dispose()
  }, 'ui-voice: controllers')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'voice',
    order: 10,
    locale: NS,
    inject: (): VoiceControlInjected => ({
      hooks: { voice: capture, playback },
      start: () => capture.start(),
      finish: () => capture.finish(),
      cancel: () => { capture.cancel() },
      acknowledgeTranscript: (transcript) => { capture.acknowledgeTranscript(transcript) },
      speak: text => playback.speak(text),
      interruptSpeech: () => { playback.interrupt() },
      stopSpeech: () => { playback.stop() },
    }),
  }, VoiceControl))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'voice-activity',
    order: -10,
    locale: NS,
    inject: (): VoiceActivityInjected => ({ hooks: { voice: capture, playback } }),
  }, VoiceActivity))
}
