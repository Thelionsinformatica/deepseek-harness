/** Registers the Leon Work dashboard into the blank-session Hero. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { remoteValue } from '@deepseek-ai/dsh-api-remotes/client'
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
      return remoteValue(carried)
    },
    review: async (sessionId, id, decision) => {
      const carried = await ctx.remote.memoryCandidateReview.markReviewed({ sessionId, id, decision })
      return remoteValue(carried).item
    },
    listMemories: async (sessionId, query, statuses) => {
      const carried = await ctx.remote.memoryCandidateReview.listMemories({
        sessionId,
        ...(query === undefined ? {} : { query }),
        ...(statuses === undefined ? {} : { statuses }),
        limit: 100,
      })
      return remoteValue(carried)
    },
    correctMemory: async (sessionId, item, content) => {
      const carried = await ctx.remote.memoryCandidateReview.correctMemory({
        sessionId,
        id: item.id,
        revision: item.revision,
        content,
        confirmed: true,
      })
      return remoteValue(carried).item
    },
    forgetMemory: async (sessionId, item) => {
      const carried = await ctx.remote.memoryCandidateReview.forgetMemory({
        sessionId,
        id: item.id,
        revision: item.revision,
        confirmed: true,
      })
      remoteValue(carried)
    },
    listPersonalMemories: async (sessionId, query) => {
      const carried = await ctx.remote.memoryCandidateReview.listPersonalMemories({
        sessionId,
        ...(query === undefined ? {} : { query }),
        statuses: ['active'],
        limit: 100,
      })
      return remoteValue(carried)
    },
    rememberPersonalMemory: async (sessionId, content) => {
      const carried = await ctx.remote.memoryCandidateReview.rememberPersonalMemory({
        sessionId,
        content,
        confirmed: true,
      })
      return remoteValue(carried).item
    },
    correctPersonalMemory: async (sessionId, item, content) => {
      const carried = await ctx.remote.memoryCandidateReview.correctPersonalMemory({
        sessionId,
        id: item.id,
        revision: item.revision,
        content,
        confirmed: true,
      })
      return remoteValue(carried).item
    },
    forgetPersonalMemory: async (sessionId, item) => {
      const carried = await ctx.remote.memoryCandidateReview.forgetPersonalMemory({
        sessionId,
        id: item.id,
        revision: item.revision,
        confirmed: true,
      })
      remoteValue(carried)
    },
    setPersonalMemoryEnabled: async (sessionId, enabled) => {
      const carried = await ctx.remote.memoryCandidateReview.setPersonalMemoryEnabled({
        sessionId,
        enabled,
        confirmed: true,
      })
      return remoteValue(carried).enabled
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
