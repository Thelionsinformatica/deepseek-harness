/** Truthful Leon activity HUD derived from the current conversation snapshot. */

import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VoiceCaptureView } from './controller.ts'
import type { VoicePlaybackView } from './playback-controller.ts'
import css from './VoiceActivity.module.css'

/** Visual states backed only by observable capture, playback, and session facts. */
export type VoiceActivityState =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'processing'
  | 'thinking'
  | 'tool'
  | 'approval'
  | 'speaking'
  | 'interrupted'
  | 'error'

/** Pure activity projection used by the HUD and its tests. */
export interface VoiceActivityDescriptor {
  readonly state: VoiceActivityState
  readonly toolName: string | null
  readonly pendingCount: number
  readonly errorSource: 'capture' | 'playback' | 'session' | null
}

/** Shared observable face supplied by the ui-voice plugin. */
export interface VoiceActivityInjected {
  hooks: {
    voice: HostObservable<VoiceCaptureView>
    playback: HostObservable<VoicePlaybackView>
  }
}

export type VoiceActivityProps =
  PropsRuntime<'conversation.composer.dock'>
  & InjectFace<VoiceActivityInjected>
  & PropsLocale<'voice'>

/** Collapse raw runtime facts into one prioritized, non-speculative state. */
export function deriveVoiceActivity(
  session: ConversationSnapshot,
  capture: VoiceCaptureView,
  playback: VoicePlaybackView,
): VoiceActivityDescriptor {
  if (capture.status === 'error') {
    return { state: 'error', toolName: null, pendingCount: session.pending.length, errorSource: 'capture' }
  }
  if (playback.status === 'error') {
    return { state: 'error', toolName: null, pendingCount: session.pending.length, errorSource: 'playback' }
  }
  if (session.promptError !== null || session.lastAgentError !== null) {
    return { state: 'error', toolName: null, pendingCount: session.pending.length, errorSource: 'session' }
  }
  if (capture.status === 'requesting') {
    return { state: 'requesting', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  if (capture.status === 'listening') {
    return { state: 'listening', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  if (capture.status === 'processing' || capture.status === 'captured'
    || capture.status === 'transcribed') {
    return { state: 'processing', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  if (playback.status === 'speaking') {
    return { state: 'speaking', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  if (session.pending.length > 0) {
    return { state: 'approval', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  const runningTool = session.runningCalls.at(-1)
  if (runningTool !== undefined) {
    return {
      state: 'tool',
      toolName: runningTool.name,
      pendingCount: session.pending.length,
      errorSource: null,
    }
  }
  if (session.running || session.partial !== null) {
    return { state: 'thinking', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  if (playback.status === 'interrupted') {
    return { state: 'interrupted', toolName: null, pendingCount: session.pending.length, errorSource: null }
  }
  return { state: 'idle', toolName: null, pendingCount: session.pending.length, errorSource: null }
}

/** Compact original Leon HUD; it never infers progress outside the session projection. */
export function VoiceActivity({ session, useVoice, usePlayback, t }: VoiceActivityProps) {
  const capture = useVoice(state => state)
  const playback = usePlayback(state => state)
  const activity = deriveVoiceActivity(session, capture, playback)
  const label = t(`activity.${activity.state}`)
  let detail = activity.state === 'error' && activity.errorSource === 'playback'
    ? t('activity.detail.playback-error')
    : t(`activity.detail.${activity.state}`)
  if (activity.state === 'tool' && activity.toolName !== null) {
    detail = `${detail}: ${activity.toolName}`
  } else if (activity.state === 'approval' && activity.pendingCount > 1) {
    detail = `${detail} (${activity.pendingCount})`
  }

  return (
    <div
      className={css.root}
      data-voice-activity=""
      data-state={activity.state}
      role="status"
      aria-live="polite"
    >
      <span className={css.orb} aria-hidden="true">
        <span className={css.core} />
        <span className={css.ring} />
      </span>
      <span className={css.copy}>
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
    </div>
  )
}
