// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
  type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { VoiceCaptureView } from '../src/client/controller.ts'
import type { VoicePlaybackView } from '../src/client/playback-controller.ts'
import { pt } from '../src/client/locales.ts'
import {
  deriveVoiceActivity, VoiceActivity, type VoiceActivityProps,
} from '../src/client/VoiceActivity.tsx'

afterEach(cleanup)

const capture: VoiceCaptureView = {
  status: 'idle', level: 0, durationMs: 0, clip: null, transcript: null, error: null,
}
const playback: VoicePlaybackView = {
  status: 'idle', text: null, voiceName: null, error: null,
}

function session(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 'activity-session' as SessionId,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

describe('VoiceActivity', () => {
  it('prioritizes approval, tool, and thinking from authoritative session facts', () => {
    expect(deriveVoiceActivity(session({ running: true }), capture, playback).state).toBe('thinking')
    expect(deriveVoiceActivity(session({
      running: true,
      runningCalls: [{ callId: 'c1', name: 'read', argsRaw: '{}', turn: 1, step: 1, time: 1,
        callView: null, subCalls: [] }],
    }), capture, playback)).toMatchObject({ state: 'tool', toolName: 'read' })
    expect(deriveVoiceActivity(session({
      running: true,
      runningCalls: [{ callId: 'c1', name: 'write', argsRaw: '{}', turn: 1, step: 1, time: 1,
        callView: null, subCalls: [] }],
      pending: [{} as never],
    }), capture, playback).state).toBe('approval')
  })

  it('keeps listening and speaking above background execution', () => {
    expect(deriveVoiceActivity(
      session({ running: true }), { ...capture, status: 'listening' }, playback,
    ).state).toBe('listening')
    expect(deriveVoiceActivity(
      session({ running: true }), capture, { ...playback, status: 'speaking', text: 'olá' },
    ).state).toBe('speaking')
  })

  it('renders the running tool name as text in the ambient HUD', () => {
    const props = {
      session: session({
        running: true,
        runningCalls: [{ callId: 'c1', name: 'leon-browser', argsRaw: '{}', turn: 1, step: 1,
          time: 1, callView: null, subCalls: [] }],
      }),
      input: {},
      useVoice: (selector: (value: VoiceCaptureView) => unknown) => selector(capture),
      usePlayback: (selector: (value: VoicePlaybackView) => unknown) => selector(playback),
      t: makeTranslate(pt),
    } as unknown as VoiceActivityProps

    render(<VoiceActivity {...props} />)

    expect(screen.getByRole('status').textContent).toContain('Executando ferramenta')
    expect(screen.getByRole('status').textContent).toContain('leon-browser')
  })

  it('explains that a playback failure does not remove the chat answer', () => {
    render(<VoiceActivity {...({
      session: session(),
      input: {},
      useVoice: (selector: (value: VoiceCaptureView) => unknown) => selector(capture),
      usePlayback: (selector: (value: VoicePlaybackView) => unknown) => selector({
        status: 'error', text: 'resposta', voiceName: null, error: 'playback-failed',
      }),
      t: makeTranslate(pt),
    } as unknown as VoiceActivityProps)} />)

    expect(screen.getByRole('status').textContent).toContain(
      'A resposta continua disponível no chat; somente a voz local falhou.',
    )
  })
})
