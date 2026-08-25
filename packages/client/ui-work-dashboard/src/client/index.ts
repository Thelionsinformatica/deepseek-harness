/** Registers the Leon Work dashboard into the blank-session Hero. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-tool-memory/remote'
import { MemoryReviewButton, type MemoryReviewInjected } from './MemoryReviewButton.tsx'
import type { WorkDashboardInjected } from './WorkDashboard.tsx'
import { WorkDashboard } from './WorkDashboard.tsx'
import { en, NS, pt, zh, type WorkDashboardKey } from './locales.ts'

export type { WorkDashboardInjected, WorkDashboardProps } from './WorkDashboard.tsx'
export type { MemoryReviewButtonProps, MemoryReviewInjected } from './MemoryReviewButton.tsx'
export type { WorkDashboardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Leon Work dashboard copy. */
    'work-dashboard': WorkDashboardKey
  }
}

/** Services required by the dashboard plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.memoryCandidateReview']

/**
 * Register the dashboard for every lifetime of the optional Hero seat.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { pt, zh, en }), 'ui-work-dashboard: dictionaries')
  ctx.slots.inject('conversation.hero.dashboard', () => ctx.slots.register({
    name: 'conversation.hero.dashboard',
    locale: NS,
    inject: (): WorkDashboardInjected => ({
      startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    }),
  }, WorkDashboard))

  const memoryReview: MemoryReviewInjected = {
    list: async (sessionId) => {
      const carried = await ctx.remote.memoryCandidateReview.list({ sessionId, reviewed: false, limit: 50 })
      if (!carried.ok) throw new Error(`${carried.error.code}: ${carried.error.message}`)
      if (!carried.value.ok) throw new Error(carried.value.error.code)
      return carried.value.value
    },
    review: async (sessionId, id, decision) => {
      const carried = await ctx.remote.memoryCandidateReview.markReviewed({ sessionId, id, decision })
      if (!carried.ok) throw new Error(`${carried.error.code}: ${carried.error.message}`)
      if (!carried.value.ok) throw new Error(carried.value.error.code)
      return carried.value.value.item
    },
  }
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'memory-review',
    order: 20,
    locale: NS,
    inject: (): MemoryReviewInjected => memoryReview,
  }, MemoryReviewButton))
}
