/** Compact microphone control for the conversation composer. */

import { useEffect, type CSSProperties } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  VoiceCaptureErrorCode, VoiceCaptureView,
} from './controller.ts'
import css from './VoiceControl.module.css'

/** Controller face supplied through the slot registration. */
export interface VoiceControlInjected {
  hooks: {
    voice: HostObservable<VoiceCaptureView>
  }
  start: () => Promise<void>
  finish: () => Promise<void>
  cancel: () => void
  acknowledgeTranscript: (transcript: string) => void
}

/** Full composer-seat props. */
export type VoiceControlProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<VoiceControlInjected>
  & PropsLocale<'voice'>

/** Microphone glyph kept package-local until the shared icon set owns one. */
function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <rect x="6" y="2.25" width="6" height="9" rx="3" fill="none" stroke="currentColor" strokeWidth="1.45" />
      <path d="M3.9 8.7a5.1 5.1 0 0 0 10.2 0M9 13.8v2.1M6.7 15.9h4.6" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  )
}

/** Translate a stable controller error. */
function errorLabel(code: VoiceCaptureErrorCode, t: VoiceControlProps['t']): string {
  switch (code) {
    case 'permission-denied': return t('error.permission-denied')
    case 'no-device': return t('error.no-device')
    case 'device-busy': return t('error.device-busy')
    case 'unsupported': return t('error.unsupported')
    case 'empty-audio': return t('error.empty-audio')
    case 'no-speech': return t('error.no-speech')
    case 'transcription-unavailable': return t('error.transcription-unavailable')
    case 'transcription-failed': return t('error.transcription-failed')
    case 'capture-failed': return t('error.capture-failed')
  }
}

/** Voice-specific label used by the tooltip and the live status line. */
function labels(view: VoiceCaptureView, t: VoiceControlProps['t']): { short: string; detail: string } {
  switch (view.status) {
    case 'idle': return { short: t('action.start'), detail: t('action.start') }
    case 'requesting': return { short: t('status.requesting'), detail: t('status.requesting') }
    case 'listening': return { short: t('status.listening'), detail: t('action.stop') }
    case 'processing': return { short: t('status.processing'), detail: t('status.processing') }
    case 'captured': return { short: t('status.captured'), detail: t('detail.captured') }
    case 'transcribed': return { short: t('status.transcribed'), detail: t('detail.transcribed') }
    case 'error': {
      const detail = errorLabel(view.error ?? 'capture-failed', t)
      return { short: detail, detail }
    }
  }
}

/** Render the microphone and submit recognized text through InputActions. */
export function VoiceControl({
  input, inputActions, useVoice, start, finish, cancel, acknowledgeTranscript, t,
}: VoiceControlProps) {
  const view = useVoice(state => state)
  const label = labels(view, t)
  const pending = view.status === 'requesting' || view.status === 'processing'

  useEffect(() => {
    if (view.status !== 'transcribed' || view.transcript === null) return
    const base = input.draft.trimEnd()
    const transcript = view.transcript
    inputActions.setDraft(base.length === 0 ? transcript : `${base} ${transcript}`)
    inputActions.submit()
    acknowledgeTranscript(transcript)
  }, [acknowledgeTranscript, input.draft, inputActions, view.status, view.transcript])

  const onClick = (): void => {
    if (view.status === 'listening') {
      void finish()
      return
    }
    if (view.status === 'requesting' || view.status === 'processing') {
      cancel()
      return
    }
    void start()
  }

  const meter = Math.round(view.level * 100)
  const style = { '--voice-level': `${meter}%` } as CSSProperties

  return (
    <div className={css.root} data-status={view.status} style={style}>
      <Tooltip label={label.detail} side="top" delayMs={300} maxWidth={280}>
        <button
          type="button"
          className={css.button}
          aria-label={view.status === 'listening' ? t('action.stop') : label.detail}
          aria-pressed={view.status === 'listening'}
          disabled={pending}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={onClick}
        >
          {view.status === 'listening'
            ? (
              <span className={css.meter} aria-hidden="true">
                <span style={{ height: `${4 + meter * 0.08}px` }} />
                <span style={{ height: `${5 + meter * 0.12}px` }} />
                <span style={{ height: `${4 + meter * 0.09}px` }} />
              </span>
            )
            : <MicrophoneIcon />}
        </button>
      </Tooltip>
      {view.status !== 'idle' && (
        <span className={css.status} role="status" aria-live="polite">{label.short}</span>
      )}
    </div>
  )
}
