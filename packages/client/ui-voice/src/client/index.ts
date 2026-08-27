/** Register Leon's local-first microphone control in the composer. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrowserVoiceCaptureDriver } from './browser-capture.ts'
import { VoiceCaptureController } from './controller.ts'
import { createLocalVoiceTranscriber } from './local-transcriber.ts'
import { en, NS, pt, zh, type VoiceKey } from './locales.ts'
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

/** Register a resource-owning controller for every declared seat lifetime. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { pt, zh, en }), 'ui-voice: dictionaries')
  ctx.slots.inject('conversation.input.right', () => {
    const controller = new VoiceCaptureController(new BrowserVoiceCaptureDriver(), {
      transcribe: createLocalVoiceTranscriber(),
    })
    const dispose = ctx.slots.register({
      name: 'conversation.input.right',
      id: 'voice',
      order: 10,
      locale: NS,
      inject: (): VoiceControlInjected => ({
        hooks: { voice: controller },
        start: () => controller.start(),
        finish: () => controller.finish(),
        cancel: () => { controller.cancel() },
        acknowledgeTranscript: (transcript) => { controller.acknowledgeTranscript(transcript) },
      }),
    }, VoiceControl)
    return () => {
      controller.dispose()
      dispose()
    }
  })
}
