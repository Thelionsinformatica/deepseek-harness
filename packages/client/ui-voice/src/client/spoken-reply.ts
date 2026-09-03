/** Conservative projection from one completed assistant answer to spoken text. */

import type {
  AssistantMessageNode, ChatConversationViewNode, ConversationSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

const MAX_SPOKEN_CHARS = 1_200
const FENCED_CODE = /```[\s\S]*?```/g

/**
 * Remove fenced code and cap long answers before handing text to a voice engine.
 *
 * @param node Finalized assistant message to project into speech.
 * @returns Speakable prose with non-text blocks excluded.
 */
export function spokenText(node: AssistantMessageNode): string {
  const prose = node.blocks
    .filter((block): block is Extract<typeof block, { kind: 'text' }> => block.kind === 'text')
    .map(block => block.text.replace(FENCED_CODE, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  if (prose.length <= MAX_SPOKEN_CHARS) return prose
  const prefix = prose.slice(0, MAX_SPOKEN_CHARS)
  const boundary = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('! '), prefix.lastIndexOf('? '))
  return `${prefix.slice(0, boundary >= 240 ? boundary + 1 : MAX_SPOKEN_CHARS).trim()}…`
}

/** Durable intent retained while the submitted voice message enters the Chat projection. */
export interface VoiceReplyArm {
  readonly sessionId: SessionId
  readonly messageId: string
  readonly targetTurn: number | null
}

/** Current causal state of one voice answer. */
export type VoiceReplyResolution =
  | { readonly status: 'pending'; readonly arm: VoiceReplyArm }
  | { readonly status: 'ready'; readonly seq: number; readonly text: string }
  | { readonly status: 'settled' }

/**
 * Create a session-bound correlation record from the Host admission receipt.
 * @param sessionId Conversation that admitted the voice message.
 * @param messageId Exact durable user-message identity returned by the Host.
 * @returns One pending correlation record with no text or timing heuristic.
 */
export function armVoiceReply(
  sessionId: SessionId,
  messageId: string,
): VoiceReplyArm {
  return {
    sessionId,
    messageId,
    targetTurn: null,
  }
}

/** Resolve the owning agent turn from an engine-owned Chat location. */
function chatTurn(node: ChatConversationViewNode): number | null {
  if (node.location.kind === 'turn' || node.location.kind === 'step') {
    return node.location.turn.turn
  }
  return null
}

/**
 * Resolve only the assistant answer owned by the durable user message that was
 * submitted from this voice arm.
 *
 * @param session Current projected conversation state.
 * @param arm Session and exact durable message identity from Host admission.
 * @returns Pending correlation, the exact ready answer, or a settled silent turn.
 */
export function resolveVoiceReply(
  session: ConversationSnapshot,
  arm: VoiceReplyArm,
): VoiceReplyResolution {
  if (session.sessionId !== arm.sessionId || session.removed) return { status: 'settled' }
  let user: ChatConversationViewNode | null = null
  for (const key of session.chat.order) {
    const node = session.chat.nodes.get(key)
    if (node === undefined || node.kind !== 'user' || node.id !== arm.messageId) continue
    if (user === null || node.anchorSeq < user.anchorSeq) user = node
  }
  if (user === null) return { status: 'pending', arm }
  const targetTurn = arm.targetTurn ?? chatTurn(user)
  const correlated: VoiceReplyArm = {
    ...arm,
    targetTurn,
  }
  if (targetTurn === null || !session.turnEnds.has(targetTurn)) {
    return { status: 'pending', arm: correlated }
  }
  let reply: { readonly seq: number; readonly text: string } | null = null
  for (const node of session.nodes) {
    if (node.kind !== 'assistant' || node.interrupted || node.turn !== targetTurn) continue
    const text = spokenText(node)
    if (text.length > 0 && (reply === null || node.seq > reply.seq)) reply = { seq: node.seq, text }
  }
  return reply === null ? { status: 'settled' } : { status: 'ready', ...reply }
}
