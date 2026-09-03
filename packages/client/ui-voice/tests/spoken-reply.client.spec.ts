import { describe, expect, it } from 'vitest'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
  type AssistantMessageNode, type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  resolveVoiceReply, spokenText, type VoiceReplyArm,
} from '../src/client/spoken-reply.ts'

function assistant(seq: number, turn: number, text: string): AssistantMessageNode {
  return {
    kind: 'assistant', seq, time: seq, turn, step: 1,
    blocks: [{ kind: 'text', text }],
  }
}

function userChat(
  text: string,
  seq: number,
  location: { readonly kind: 'unresolved' } | { readonly kind: 'turn'; readonly turn: number },
): ConversationSnapshot['chat'] {
  const key = `user-${seq}`
  const node = {
    key,
    kind: 'user',
    id: `message-${seq}`,
    target: 'chat',
    anchorSeq: seq,
    location: location.kind === 'unresolved'
      ? location
      : { kind: 'turn', turn: { turn: location.turn } },
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

function session(
  nodes: readonly AssistantMessageNode[],
  overrides: Partial<ConversationSnapshot> = {},
): ConversationSnapshot {
  return {
    sessionId: 'spoken-reply' as SessionId,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    subagent: null,
    lastAgentError: null,
    ...overrides,
  }
}

const arm: VoiceReplyArm = {
  sessionId: 'spoken-reply' as SessionId,
  messageId: 'message-15',
  targetTurn: null,
}

describe('spoken reply selection', () => {
  it('selects the target message turn even when an older running turn closes later', () => {
    const snapshot = session([
      assistant(12, 1, 'Resposta do turno anterior.'),
      assistant(12, 2, 'Vou verificar.'),
      assistant(18, 2, 'Concluí a solicitação por voz.'),
      assistant(28, 3, 'Resposta de uma mensagem digitada depois.'),
    ], {
      chat: userChat('pedido por voz', 15, { kind: 'turn', turn: 2 }),
      turnEnds: new Map([[1, 14], [2, 20], [3, 30]]),
    })

    expect(resolveVoiceReply(snapshot, arm)).toEqual({
      status: 'ready',
      seq: 18,
      text: 'Concluí a solicitação por voz.',
    })
  })

  it('waits for an unresolved user node to acquire its target turn', () => {
    const unresolved = session([], {
      chat: userChat('pedido por voz', 15, { kind: 'unresolved' }),
    })
    const pending = resolveVoiceReply(unresolved, arm)
    expect(pending).toMatchObject({
      status: 'pending',
      arm: { messageId: 'message-15', targetTurn: null },
    })

    const correlatedArm = pending.status === 'pending' ? pending.arm : arm
    const open = session([assistant(18, 2, 'Ainda executando.')], {
      chat: userChat('pedido por voz', 15, { kind: 'turn', turn: 2 }),
    })
    expect(resolveVoiceReply(open, correlatedArm).status).toBe('pending')
  })

  it('settles without speech when the target turn has no speakable prose', () => {
    const codeOnly = assistant(18, 2, '```ts\nconst value = 1\n```')
    const snapshot = session([codeOnly], {
      chat: userChat('pedido por voz', 15, { kind: 'turn', turn: 2 }),
      turnEnds: new Map([[2, 20]]),
    })

    expect(resolveVoiceReply(snapshot, arm)).toEqual({ status: 'settled' })
  })

  it('does not correlate a same-text message with a different durable id', () => {
    expect(resolveVoiceReply(session([], {
      chat: userChat('pedido por voz', 16, { kind: 'turn', turn: 2 }),
    }), arm)).toEqual({ status: 'pending', arm })
  })

  it('removes fenced code before local synthesis', () => {
    expect(spokenText(assistant(1, 1, 'Resultado. ```ts\nconst secret = 1\n``` Pronto.'))).toBe(
      'Resultado. Pronto.',
    )
  })
})
