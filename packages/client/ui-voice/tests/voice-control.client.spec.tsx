// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
  type ChatConversationViewNode, type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { VoiceCaptureView } from '../src/client/controller.ts'
import type { VoicePlaybackView } from '../src/client/playback-controller.ts'
import { pt } from '../src/client/locales.ts'
import {
  VoiceControl, type VoiceControlProps,
} from '../src/client/VoiceControl.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const idle: VoiceCaptureView = {
  status: 'idle', level: 0, durationMs: 0, clip: null, transcript: null, error: null,
}
const playbackIdle: VoicePlaybackView = {
  status: 'idle', text: null, voiceName: null, error: null,
}

function session(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 'voice-session' as SessionId,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

function chatWithUser(text: string, seq: number, turn: number): ConversationSnapshot['chat'] {
  const key = `user-${seq}`
  const node = {
    key,
    kind: 'user',
    id: `message-${seq}`,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'turn', turn: { turn } },
    visibility: 'visible',
    data: { content: [{ type: 'text', text }] },
  } as never
  return {
    ...EMPTY_CHAT_SNAPSHOT,
    order: [key],
    nodes: {
      get: candidate => candidate === key ? node : undefined,
      values: () => [node],
    },
  }
}

function chatWithUsers(entries: readonly {
  readonly text: string
  readonly seq: number
  readonly turn: number
}[]): ConversationSnapshot['chat'] {
  const nodes: readonly ChatConversationViewNode[] = entries.map(({ text, seq, turn }) => ({
    key: `user-${seq}`,
    kind: 'user',
    id: `message-${seq}`,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'turn', turn: { turn } },
    visibility: 'visible',
    data: { content: [{ type: 'text', text }] },
  } as ChatConversationViewNode))
  return {
    ...EMPTY_CHAT_SNAPSHOT,
    order: nodes.map(node => node.key),
    nodes: {
      get: (candidate) => {
        return nodes.find(node => node.key === candidate)
      },
      values: () => nodes,
    },
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function createVoiceSource(initial: VoiceCaptureView) {
  let current = initial
  const listeners = new Set<() => void>()
  const getSnapshot = (): VoiceCaptureView => current
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    publish(view: VoiceCaptureView): void {
      current = view
      for (const listener of listeners) listener()
    },
    useVoice: <T,>(selector: (state: VoiceCaptureView) => T): T => {
      return selector(useSyncExternalStore(subscribe, getSnapshot))
    },
  }
}

function props(view: VoiceCaptureView, overrides: Partial<VoiceControlProps> = {}): VoiceControlProps {
  return {
    input: {
      draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
    },
    inputActions: {
      setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn(),
      submitTracked: vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-voice' as never })),
    },
    session: session(),
    useVoice: (selector: (state: VoiceCaptureView) => unknown) => selector(view),
    usePlayback: (selector: (state: VoicePlaybackView) => unknown) => selector(playbackIdle),
    start: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    cancel: vi.fn(),
    acknowledgeTranscript: vi.fn(),
    speak: vi.fn(async () => undefined),
    interruptSpeech: vi.fn(),
    stopSpeech: vi.fn(),
    t: makeTranslate(pt),
    ...overrides,
  } as unknown as VoiceControlProps
}

describe('VoiceControl', () => {
  it('starts from the microphone button and stops from the live meter', () => {
    const start = vi.fn(async () => undefined)
    const first = props(idle, { start })
    const view = render(<VoiceControl {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    expect(start).toHaveBeenCalledOnce()

    const finish = vi.fn(async () => undefined)
    view.rerender(<VoiceControl {...props({ ...idle, status: 'listening', level: 0.5 }, { finish })} />)
    expect(screen.getByText('Leon está ouvindo…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Parar gravação' }))
    expect(finish).toHaveBeenCalledOnce()
  })

  it('shows a useful permission failure without browser exception text', () => {
    render(<VoiceControl {...props({
      ...idle, status: 'error', error: 'permission-denied',
    })} />)

    expect(screen.getByRole('status').textContent).toBe(
      'Permita o acesso ao microfone nas configurações do navegador.',
    )
  })

  it('keeps a transcript for review when the composer already contains text', () => {
    const setDraft = vi.fn()
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-voice' as never }))
    const acknowledgeTranscript = vi.fn()
    const start = vi.fn(async () => undefined)
    const stable = props(idle, {
      input: { ...props(idle).input, draft: 'Leon,' },
      inputActions: { ...props(idle).inputActions, setDraft, submitTracked },
      acknowledgeTranscript,
      start,
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'agende para amanhã',
    })} />)

    expect(setDraft).toHaveBeenCalledWith('Leon, agende para amanhã')
    expect(submitTracked).not.toHaveBeenCalled()
    expect(acknowledgeTranscript).toHaveBeenCalledWith('agende para amanhã')
    expect(screen.getByRole('status').textContent).toBe('Revise a transcrição antes de enviar.')
  })

  it('speaks only the new finalized answer that follows a voice submission', async () => {
    const speak = vi.fn(async (_text: string) => undefined)
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-6' as never }))
    const initialSession = session({
      nodes: [{
        kind: 'assistant', seq: 3, time: 1, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'resposta antiga' }],
      }],
      turnEnds: new Map([[1, 4]]),
    })
    const stable = props(idle, {
      session: initialSession,
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'continue o trabalho',
    })} />)

    expect(speak).not.toHaveBeenCalled()
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    rendered.rerender(<VoiceControl {...stable}
      useVoice={selector => selector(idle)}
      session={session({
        chat: chatWithUser('continue o trabalho', 6, 2),
        nodes: [
          ...initialSession.nodes,
          {
            kind: 'assistant', seq: 8, time: 2, turn: 2, step: 1,
            blocks: [{ kind: 'text', text: 'Concluí a nova etapa.' }],
          },
        ],
        turnEnds: new Map([[1, 4], [2, 9]]),
      })}
    />)

    await waitFor(() => { expect(speak).toHaveBeenCalledOnce() })
    expect(speak).toHaveBeenCalledWith('Concluí a nova etapa.')
  })

  it('interrupts only speech before beginning a new capture', () => {
    const interruptSpeech = vi.fn()
    const start = vi.fn(async () => undefined)
    render(<VoiceControl {...props(idle, {
      start,
      interruptSpeech,
      usePlayback: selector => selector({
        status: 'speaking', text: 'resposta', voiceName: 'Daniel', error: null,
      }),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Interromper a voz e falar' }))
    expect(interruptSpeech).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })

  it('accepts a spoken follow-up while the agent is already working', () => {
    const interruptSpeech = vi.fn()
    const start = vi.fn(async () => undefined)
    render(<VoiceControl {...props(idle, {
      start,
      interruptSpeech,
      session: session({ running: true }),
      usePlayback: selector => selector({
        status: 'speaking', text: 'resposta', voiceName: 'Daniel', error: null,
      }),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Interromper a voz e falar' }))
    expect(interruptSpeech).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
  })

  it('discards a late transcript after switching conversations', () => {
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-late' as never }))
    const acknowledgeTranscript = vi.fn()
    const cancel = vi.fn()
    const stable = props(idle, {
      cancel,
      acknowledgeTranscript,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))

    rendered.rerender(<VoiceControl {...stable}
      session={session({ sessionId: 'other-session' as SessionId })}
      useVoice={selector => selector({
        ...idle, status: 'transcribed', transcript: 'não enviar aqui',
      })}
    />)

    expect(cancel).toHaveBeenCalled()
    expect(submitTracked).not.toHaveBeenCalled()
    expect(acknowledgeTranscript).not.toHaveBeenCalled()
  })

  it('keeps a transcript as a draft when the session becomes busy before submission', () => {
    const setDraft = vi.fn()
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-busy' as never }))
    const acknowledgeTranscript = vi.fn()
    const stable = props(idle, {
      acknowledgeTranscript,
      inputActions: { ...props(idle).inputActions, setDraft, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable}
      session={session({ pending: [{ kind: 'approval' } as never] })}
      useVoice={selector => selector({
        ...idle, status: 'transcribed', transcript: 'guardar para depois',
      })}
    />)

    expect(setDraft).toHaveBeenCalledWith('guardar para depois')
    expect(submitTracked).not.toHaveBeenCalled()
    expect(acknowledgeTranscript).toHaveBeenCalledWith('guardar para depois')
  })

  it('does not speak a later answer after the voice send fails', async () => {
    const speak = vi.fn(async () => undefined)
    const submitTracked = vi.fn(async () => ({ kind: 'error' as const, text: 'failed' }))
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'teste',
    })} />)
    rendered.rerender(<VoiceControl {...stable}
      useVoice={selector => selector(idle)}
      session={session({
        promptError: { op: 'send', error: { code: 'unavailable', message: 'failed' } } as never,
      })}
    />)
    rendered.rerender(<VoiceControl {...stable}
      useVoice={selector => selector(idle)}
      session={session({
        nodes: [{
          kind: 'assistant', seq: 5, time: 2, turn: 1, step: 1,
          blocks: [{ kind: 'text', text: 'resposta de outro envio' }],
        }],
        turnEnds: new Map([[1, 6]]),
      })}
    />)

    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    expect(speak).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
  })

  it('disables a new capture only while a blocking interaction is active', () => {
    const start = vi.fn(async () => undefined)
    render(<VoiceControl {...props(idle, {
      session: session({ pending: [{ kind: 'approval' } as never] }),
      start,
    })} />)

    const button = screen.getByRole('button', {
      name: 'Conclua a interação pendente antes de falar.',
    })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(start).not.toHaveBeenCalled()
  })

  it('does not start voice in a removed conversation', () => {
    const start = vi.fn(async () => undefined)
    render(<VoiceControl {...props(idle, {
      session: session({ removed: true }),
      start,
    })} />)

    const button = screen.getByRole('button', {
      name: 'A voz não está disponível nesta conversa.',
    })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(start).not.toHaveBeenCalled()
  })

  it('ends an active voice conversation when its session is removed', () => {
    const cancel = vi.fn()
    const stopSpeech = vi.fn()
    const stable = props(idle, { cancel, stopSpeech })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))

    rendered.rerender(<VoiceControl {...stable} session={session({ removed: true })} />)

    expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('esta conversa não está disponível')
    expect(cancel).toHaveBeenCalled()
    expect(stopSpeech).toHaveBeenCalled()
  })

  it('keeps a live voice session active and exposes an explicit end control', () => {
    const start = vi.fn(async () => undefined)
    const cancel = vi.fn()
    const stopSpeech = vi.fn()
    render(<VoiceControl {...props(idle, { start, cancel, stopSpeech })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    expect(start).toHaveBeenCalledOnce()
    expect(screen.getByText('Conversa por voz ativa')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar conversa por voz' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(stopSpeech).toHaveBeenCalledOnce()
  })

  it('does not reopen capture while the admitted voice message is awaiting its reply', async () => {
    const source = createVoiceSource(idle)
    const start = vi.fn(async () => undefined)
    const receipt = deferred<{ readonly kind: 'success'; readonly messageId: string }>()
    const submitTracked = vi.fn(() => receipt.promise)
    const acknowledgeTranscript = vi.fn(() => { source.publish(idle) })
    const stable = props(idle, {
      start,
      acknowledgeTranscript,
      inputActions: { ...props(idle).inputActions, submitTracked },
      useVoice: source.useVoice,
    })
    render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))

    await act(async () => {
      source.publish({ ...idle, status: 'transcribed', transcript: 'continue' })
    })

    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    expect(acknowledgeTranscript).toHaveBeenCalledWith('continue')
    expect(start).toHaveBeenCalledOnce()
  })

  it('reopens the microphone after Leon finishes speaking in live mode', async () => {
    const start = vi.fn(async () => undefined)
    const speakDone = deferred<undefined>()
    const speak = vi.fn(() => speakDone.promise)
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-6' as never }))
    const stable = props(idle, {
      start,
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    expect(start).toHaveBeenCalledOnce()

    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'continue',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('continue', 6, 2),
        nodes: [{
          kind: 'assistant', seq: 8, time: 2, turn: 2, step: 1,
          blocks: [{ kind: 'text', text: 'Concluído.' }],
        }],
        turnEnds: new Map([[2, 9]]),
      })}
      useVoice={selector => selector(idle)}
    />)
    await waitFor(() => { expect(speak).toHaveBeenCalledWith('Concluído.') })

    await act(async () => { speakDone.resolve(undefined) })

    await waitFor(() => { expect(start).toHaveBeenCalledTimes(2) })
  })

  it('ignores a Host receipt that arrives after the user ends live voice', async () => {
    const receipt = deferred<{ readonly kind: 'success'; readonly messageId: string }>()
    const submitTracked = vi.fn(() => receipt.promise)
    const speak = vi.fn(async () => undefined)
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'continue',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar conversa por voz' }))
    await act(async () => { receipt.resolve({ kind: 'success', messageId: 'message-6' }) })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('continue', 6, 2),
        nodes: [{
          kind: 'assistant', seq: 8, time: 2, turn: 2, step: 1,
          blocks: [{ kind: 'text', text: 'Resposta atrasada.' }],
        }],
        turnEnds: new Map([[2, 9]]),
      })}
      useVoice={selector => selector(idle)}
    />)

    expect(speak).not.toHaveBeenCalled()
  })

  it('does not revive an old voice cycle after leaving and returning to the same session', async () => {
    const receipt = deferred<{ readonly kind: 'success'; readonly messageId: string }>()
    const submitTracked = vi.fn(() => receipt.promise)
    const speak = vi.fn(async () => undefined)
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'continue',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })

    rendered.rerender(<VoiceControl {...stable}
      session={session({ sessionId: 'other-session' as SessionId })}
      useVoice={selector => selector(idle)}
    />)
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector(idle)} />)
    await act(async () => { receipt.resolve({ kind: 'success', messageId: 'message-6' }) })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('continue', 6, 2),
        nodes: [{
          kind: 'assistant', seq: 8, time: 2, turn: 2, step: 1,
          blocks: [{ kind: 'text', text: 'Resposta de ciclo antigo.' }],
        }],
        turnEnds: new Map([[2, 9]]),
      })}
      useVoice={selector => selector(idle)}
    />)

    expect(speak).not.toHaveBeenCalled()
  })

  it('speaks concurrent follow-ups in submission order when receipts arrive out of order', async () => {
    const first = deferred<{ readonly kind: 'success'; readonly messageId: string }>()
    const second = deferred<{ readonly kind: 'success'; readonly messageId: string }>()
    const submitTracked = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const speak = vi.fn(async (_text: string) => undefined)
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'primeira',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledTimes(1) })
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector(idle)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'segunda',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledTimes(2) })
    await act(async () => { second.resolve({ kind: 'success', messageId: 'message-2' }) })

    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('segunda', 2, 2),
        nodes: [{
          kind: 'assistant', seq: 4, time: 2, turn: 2, step: 1,
          blocks: [{ kind: 'text', text: 'Resposta dois.' }],
        }],
        turnEnds: new Map([[2, 5]]),
      })}
      useVoice={selector => selector(idle)}
    />)
    expect(speak).not.toHaveBeenCalled()

    await act(async () => { first.resolve({ kind: 'success', messageId: 'message-1' }) })
    const finalChat = chatWithUsers([
      { text: 'primeira', seq: 1, turn: 1 },
      { text: 'segunda', seq: 2, turn: 2 },
    ])
    expect(finalChat.nodes.get('user-2')).toMatchObject({ id: 'message-2' })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: finalChat,
        nodes: [
          {
            kind: 'assistant', seq: 3, time: 1, turn: 1, step: 1,
            blocks: [{ kind: 'text', text: 'Resposta um.' }],
          },
          {
            kind: 'assistant', seq: 4, time: 2, turn: 2, step: 1,
            blocks: [{ kind: 'text', text: 'Resposta dois.' }],
          },
        ],
        turnEnds: new Map([[1, 3], [2, 5]]),
      })}
      useVoice={selector => selector(idle)}
    />)

    await waitFor(() => {
      expect(speak.mock.calls.map(call => call[0])).toEqual(['Resposta um.', 'Resposta dois.'])
    })
  })

  it('requires manual review when the draft changes during transcription', () => {
    const setDraft = vi.fn()
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-voice' }))
    const stable = props(idle, {
      inputActions: { ...props(idle).inputActions, setDraft, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable}
      input={{ ...stable.input, draft: 'texto digitado', draftRev: 1 }}
      useVoice={selector => selector({
        ...idle, status: 'transcribed', transcript: 'fala reconhecida',
      })}
    />)

    expect(setDraft).toHaveBeenCalledWith('texto digitado fala reconhecida')
    expect(submitTracked).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Revise a transcrição antes de enviar.')
  })

  it('ends live voice when the composer handles a command without a Host message', async () => {
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const }))
    const stable = props(idle, {
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'comando tratado',
    })} />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
    })
    expect(screen.getByRole('status').textContent).toContain('Conversa por voz encerrada')
  })

  it('continues listening after a finalized turn has no speakable prose', async () => {
    const start = vi.fn(async () => undefined)
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-6' }))
    const stable = props(idle, {
      start,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'execute silenciosamente',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('execute silenciosamente', 6, 2),
        nodes: [],
        turnEnds: new Map([[2, 9]]),
      })}
      useVoice={selector => selector(idle)}
    />)

    await waitFor(() => { expect(start).toHaveBeenCalledTimes(2) })
  })

  it('ends live voice when local speech playback fails', async () => {
    const speakDone = deferred<undefined>()
    const speak = vi.fn(() => speakDone.promise)
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-6' }))
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'responda',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })
    rendered.rerender(<VoiceControl {...stable}
      session={session({
        chat: chatWithUser('responda', 6, 2),
        nodes: [{
          kind: 'assistant', seq: 8, time: 2, turn: 2, step: 1,
          blocks: [{ kind: 'text', text: 'Resposta.' }],
        }],
        turnEnds: new Map([[2, 9]]),
      })}
      useVoice={selector => selector(idle)}
    />)
    await waitFor(() => { expect(speak).toHaveBeenCalledOnce() })
    rendered.rerender(<VoiceControl {...stable}
      useVoice={selector => selector(idle)}
      usePlayback={selector => selector({
        status: 'error', text: 'Resposta.', voiceName: null, error: 'playback-failed',
      })}
    />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
    })
  })

  it('ends live voice when the admitted agent turn fails before turn/end', async () => {
    const speak = vi.fn(async () => undefined)
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-6' }))
    const stable = props(idle, {
      speak,
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'responda',
    })} />)
    await waitFor(() => { expect(submitTracked).toHaveBeenCalledOnce() })

    rendered.rerender(<VoiceControl {...stable}
      session={session({ chat: chatWithUser('responda', 6, 2) })}
      useVoice={selector => selector(idle)}
    />)
    await waitFor(() => {
      rendered.rerender(<VoiceControl {...stable}
        session={session({
          chat: chatWithUser('responda', 6, 2),
          lastAgentError: 'agent failed before turn/end',
        })}
        useVoice={selector => selector(idle)}
      />)
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
    })
    expect(screen.getByRole('status').textContent).toContain('Conversa por voz encerrada')
    expect(speak).not.toHaveBeenCalled()
  })

  it('ends the voice cycle when an admitted message never reaches the chat projection', async () => {
    vi.useFakeTimers()
    const submitTracked = vi.fn(async () => ({ kind: 'success' as const, messageId: 'message-missing' }))
    const stable = props(idle, {
      inputActions: { ...props(idle).inputActions, submitTracked },
    })
    const rendered = render(<VoiceControl {...stable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    rendered.rerender(<VoiceControl {...stable} useVoice={selector => selector({
      ...idle, status: 'transcribed', transcript: 'mensagem sem projeção',
    })} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(submitTracked).toHaveBeenCalledOnce()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })

    expect(screen.queryByRole('button', { name: 'Encerrar conversa por voz' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('voz foi encerrada por demora')
  })
})
