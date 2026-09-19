/** Compact microphone control for the conversation composer. */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  VoiceCaptureErrorCode, VoiceCaptureView,
} from './controller.ts'
import type { VoicePlaybackView } from './playback-controller.ts'
import {
  armVoiceReply, resolveVoiceReply, type VoiceReplyArm,
} from './spoken-reply.ts'
import css from './VoiceControl.module.css'

/** Controller face supplied through the slot registration. */
export interface VoiceControlInjected {
  hooks: {
    voice: HostObservable<VoiceCaptureView>
    playback: HostObservable<VoicePlaybackView>
  }
  start: () => Promise<void>
  finish: () => Promise<void>
  cancel: () => void
  acknowledgeTranscript: (transcript: string) => void
  speak: (text: string) => Promise<void>
  interruptSpeech: () => void
  stopSpeech: () => void
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

const VOICE_PROJECTION_TIMEOUT_MS = 30_000

interface VoiceCaptureContext {
  readonly sessionId: VoiceReplyArm['sessionId']
  readonly draft: string
  readonly draftRev: number
  readonly safeAutoSubmit: boolean
}

type VoiceReplyQueueItem = {
  readonly order: number
  readonly epoch: number
  readonly sessionId: VoiceReplyArm['sessionId']
  readonly startedAt: number
} & (
  | { readonly status: 'admitting' }
  | { readonly status: 'armed'; readonly arm: VoiceReplyArm }
)

/** Append recognized speech without erasing a draft that requires manual review. */
function appendTranscript(draft: string, transcript: string): string {
  const base = draft.trimEnd()
  return base.length === 0 ? transcript : `${base} ${transcript}`
}

/** Render the microphone and submit recognized text through InputActions. */
export function VoiceControl({
  session, input, inputActions, useVoice, usePlayback, start, finish, cancel,
  acknowledgeTranscript, speak, interruptSpeech, stopSpeech, t,
}: VoiceControlProps) {
  const view = useVoice(state => state)
  const playback = usePlayback(state => state)
  const captureBlocked = session.removed || session.pending.length > 0 || input.phase !== 'plain'
  const label = session.removed
    ? { short: t('status.unavailable'), detail: t('action.unavailable') }
    : playback.status === 'speaking'
      ? {
        short: t('status.speaking'),
        detail: captureBlocked ? t('action.interrupt') : t('action.interrupt-and-speak'),
      }
      : view.status === 'idle' && captureBlocked
        ? { short: t('action.busy'), detail: t('action.busy') }
        : labels(view, t)
  const [live, setLive] = useState(false)
  const [liveNotice, setLiveNotice] = useState<string | null>(null)
  const [replyQueue, setReplyQueue] = useState<readonly VoiceReplyQueueItem[]>([])
  const [speechSettlement, setSpeechSettlement] = useState(0)
  const liveRef = useRef(false)
  const activeSession = useRef(session.sessionId)
  const renderedSession = useRef(session.sessionId)
  renderedSession.current = session.sessionId
  const liveEpoch = useRef(0)
  const voiceSubmitOrder = useRef(0)
  const replyQueueRef = useRef<readonly VoiceReplyQueueItem[]>([])
  const captureContext = useRef<VoiceCaptureContext | null>(null)
  const handledTranscript = useRef<string | null>(null)
  const speechInFlight = useRef(false)
  const lastProcessedReplyOrder = useRef(0)

  const replaceReplyQueue = useCallback((
    update: (current: readonly VoiceReplyQueueItem[]) => readonly VoiceReplyQueueItem[],
  ): void => {
    const next = update(replyQueueRef.current)
    replyQueueRef.current = next
    setReplyQueue(next)
  }, [])

  const deactivateLive = useCallback(({
    notice = null,
    resetCapture = true,
    resetPlayback = true,
  }: {
    readonly notice?: string | null
    readonly resetCapture?: boolean
    readonly resetPlayback?: boolean
  } = {}): void => {
    liveEpoch.current += 1
    liveRef.current = false
    setLive(false)
    setLiveNotice(notice)
    captureContext.current = null
    handledTranscript.current = null
    speechInFlight.current = false
    lastProcessedReplyOrder.current = 0
    replaceReplyQueue(() => [])
    if (resetCapture) cancel()
    if (resetPlayback) stopSpeech()
  }, [cancel, replaceReplyQueue, stopSpeech])

  const beginCapture = useCallback((interrupt = true): void => {
    if (captureBlocked || captureContext.current !== null) return
    if (interrupt) interruptSpeech()
    liveRef.current = true
    setLive(true)
    setLiveNotice(null)
    captureContext.current = {
      sessionId: session.sessionId,
      draft: input.draft,
      draftRev: input.draftRev,
      safeAutoSubmit: input.draft.trim() === ''
        && input.imageIds.length === 0
        && input.occurrences.length === 0,
    }
    handledTranscript.current = null
    void start().catch(() => {
      deactivateLive({ resetCapture: false, resetPlayback: false })
    })
  }, [
    captureBlocked, deactivateLive, input.draft, input.draftRev, input.imageIds.length,
    input.occurrences.length, interruptSpeech, session.sessionId, start,
  ])

  const endLiveConversation = (): void => {
    deactivateLive()
  }

  useEffect(() => () => {
    liveEpoch.current += 1
    liveRef.current = false
    captureContext.current = null
    handledTranscript.current = null
    speechInFlight.current = false
    lastProcessedReplyOrder.current = 0
    replyQueueRef.current = []
    cancel()
    stopSpeech()
  }, [cancel, stopSpeech])

  useEffect(() => {
    if (activeSession.current === session.sessionId) return
    activeSession.current = session.sessionId
    deactivateLive()
  }, [deactivateLive, session.sessionId])

  useEffect(() => {
    if (view.status !== 'transcribed' || view.transcript === null) return
    const captured = captureContext.current
    if (captured === null || captured.sessionId !== session.sessionId) return
    if (handledTranscript.current === view.transcript) return
    handledTranscript.current = view.transcript
    const transcript = view.transcript
    const submittedText = appendTranscript(input.draft, transcript)
    const unchangedDraft = input.draft === captured.draft && input.draftRev === captured.draftRev
    const safeAutoSubmit = captured.safeAutoSubmit
      && unchangedDraft
      && input.imageIds.length === 0
      && input.occurrences.length === 0
      && !transcript.trimStart().startsWith('/')
    inputActions.setDraft(submittedText)
    captureContext.current = null
    if (captureBlocked || !safeAutoSubmit) {
      acknowledgeTranscript(transcript)
      deactivateLive({
        notice: safeAutoSubmit ? t('status.ended-error') : t('status.review-draft'),
        resetCapture: false,
        resetPlayback: false,
      })
      return
    }
    const owner = session.sessionId
    const epoch = liveEpoch.current
    const order = ++voiceSubmitOrder.current
    const pending: VoiceReplyQueueItem = {
      status: 'admitting', order, epoch, sessionId: owner, startedAt: Date.now(),
    }
    replaceReplyQueue(current => [...current, pending].sort((a, b) => a.order - b.order))
    acknowledgeTranscript(transcript)
    void Promise.resolve()
      .then(() => inputActions.submitTracked())
      .then((outcome) => {
        if (!liveRef.current || liveEpoch.current !== epoch
          || renderedSession.current !== owner) return
        if (outcome.kind !== 'success' || outcome.messageId === undefined) {
          deactivateLive({
            notice: t('status.ended-error'), resetCapture: false, resetPlayback: false,
          })
          return
        }
        const messageId = outcome.messageId
        replaceReplyQueue(current => current.map(item => item.order === order
          ? { ...item, status: 'armed', arm: armVoiceReply(owner, messageId) }
          : item))
      }, () => {
        if (liveEpoch.current !== epoch || renderedSession.current !== owner) return
        deactivateLive({
          notice: t('status.ended-error'), resetCapture: false, resetPlayback: false,
        })
      })
  }, [
    acknowledgeTranscript, captureBlocked, deactivateLive, input.draft, input.draftRev,
    input.imageIds.length, input.occurrences.length, inputActions, replaceReplyQueue,
    session.sessionId, t, view.status, view.transcript,
  ])

  useEffect(() => {
    if (session.promptError?.op === 'send') {
      if (replyQueue.length > 0) {
        deactivateLive({
          notice: t('status.ended-error'), resetCapture: false, resetPlayback: false,
        })
      }
      return
    }
    const head = replyQueue[0]
    if (head === undefined || head.status !== 'armed' || view.status !== 'idle'
      || speechInFlight.current || playback.status === 'speaking') return
    const reply = resolveVoiceReply(session, head.arm)
    if (reply.status === 'pending') {
      if (reply.arm.targetTurn !== head.arm.targetTurn) {
        replaceReplyQueue(current => current.map(item => item.order === head.order
          && item.status === 'armed'
          ? { ...item, arm: reply.arm }
          : item))
      }
      return
    }
    if (head.order <= lastProcessedReplyOrder.current) return
    lastProcessedReplyOrder.current = head.order
    replaceReplyQueue(current => current.filter(item => item.order !== head.order))
    if (reply.status !== 'ready') return
    const epoch = head.epoch
    speechInFlight.current = true
    void speak(reply.text).then(() => {
      if (liveEpoch.current !== epoch || renderedSession.current !== head.sessionId) return
      speechInFlight.current = false
      setSpeechSettlement(value => value + 1)
    }, () => {
      if (liveEpoch.current !== epoch || renderedSession.current !== head.sessionId) return
      deactivateLive({
        notice: t('status.ended-error'), resetCapture: false, resetPlayback: false,
      })
    })
  }, [
    deactivateLive, playback.status, replaceReplyQueue, replyQueue, session, speak, t,
    speechSettlement, view.status,
  ])

  useEffect(() => {
    if (!live || !liveRef.current || captureBlocked || replyQueue.length > 0
      || replyQueueRef.current.length > 0 || speechInFlight.current
      || captureContext.current !== null
      || playback.status !== 'idle' || view.status !== 'idle') return
    beginCapture(false)
  }, [
    beginCapture, captureBlocked, live, playback.status, replyQueue.length, speechSettlement,
    view.status,
  ])

  useEffect(() => {
    const head = replyQueue[0]
    if (head === undefined || (head.status === 'armed' && head.arm.targetTurn !== null)) return
    const remaining = Math.max(0, VOICE_PROJECTION_TIMEOUT_MS - (Date.now() - head.startedAt))
    const timeout = setTimeout(() => {
      const current = replyQueueRef.current[0]
      if (current?.order !== head.order || current.epoch !== head.epoch) return
      if (current.status === 'armed' && current.arm.targetTurn !== null) return
      deactivateLive({
        notice: t('status.reply-timeout'), resetCapture: false, resetPlayback: false,
      })
    }, remaining)
    return () => { clearTimeout(timeout) }
  }, [deactivateLive, replyQueue, t])

  useEffect(() => {
    if (!liveRef.current) return
    if (view.status === 'error' || view.status === 'captured') {
      deactivateLive({ resetCapture: false, resetPlayback: false })
      return
    }
    if (playback.status === 'error') {
      deactivateLive({ resetCapture: false, resetPlayback: false })
    }
  }, [deactivateLive, playback.status, view.status])

  useEffect(() => {
    if (!liveRef.current || !session.removed) return
    deactivateLive({ notice: t('status.unavailable') })
  }, [deactivateLive, session.removed, t])

  useEffect(() => {
    if (!liveRef.current || session.lastAgentError === null) return
    const head = replyQueue[0]
    if (head?.status !== 'armed' || head.arm.targetTurn === null
      || session.turnEnds.has(head.arm.targetTurn)) return
    deactivateLive({ notice: t('status.ended-error') })
  }, [deactivateLive, replyQueue, session.lastAgentError, session.turnEnds, t])

  useEffect(() => {
    if (!liveRef.current || session.pending.length === 0) return
    deactivateLive({ notice: t('status.blocked') })
  }, [deactivateLive, session.pending.length, t])

  const onClick = (): void => {
    if (playback.status === 'speaking') {
      beginCapture()
      return
    }
    if (view.status === 'listening') {
      void finish()
      return
    }
    if (view.status === 'requesting' || view.status === 'processing') {
      endLiveConversation()
      return
    }
    beginCapture()
  }

  const meter = Math.round(view.level * 100)
  const style = { '--voice-level': `${meter}%` } as CSSProperties

  return (
    <div
      className={css.root}
      data-status={view.status}
      data-playback={playback.status}
      data-live={live ? 'true' : 'false'}
      style={style}
    >
      <Tooltip label={label.detail} side="top" delayMs={300} maxWidth={280}>
        <button
          type="button"
          className={css.button}
          aria-label={view.status === 'listening' ? t('action.stop') : label.detail}
          aria-pressed={view.status === 'listening'}
          disabled={captureBlocked && view.status === 'idle' && playback.status !== 'speaking'}
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
      {(liveNotice !== null || live || view.status !== 'idle' || playback.status === 'speaking') && (
        <span className={css.status} role="status" aria-live="polite">
          {liveNotice ?? (live && view.status === 'idle' && playback.status === 'idle'
            ? t('status.live')
            : label.short)}
        </span>
      )}
      {live && (
        <Tooltip label={t('action.end-live')} side="top" delayMs={300}>
          <button
            type="button"
            className={css.endButton}
            aria-label={t('action.end-live')}
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={endLiveConversation}
          >
            <span aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
