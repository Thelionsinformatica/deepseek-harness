import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ModelFailoverNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import { chatNode } from './common.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Automatic provider replacement after the active route became unavailable. */
    'model-failover': ModelFailoverNode
  }
}

/** Automatic model-failover Definition. */
export const failoverDefinition: ConversationNodeDefinition<ModelFailoverNode> = {
  kind: 'model-failover',
  target: 'chat',
  match: event => event.type === 'llm/failover'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'llm/failover') throw new Error('model-failover start requires llm/failover')
    return {
      kind: 'model-failover',
      seq: match.event.seq,
      time: match.event.time,
      ...match.event.data,
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : chatNode(context, 'model-failover', context.state.seq, context.state),
}

/**
 * Register the automatic model-failover business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerFailoverConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(failoverDefinition)
}
