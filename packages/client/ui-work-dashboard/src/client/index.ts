/** Registers the Leon Work dashboard into the blank-session Hero. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkDashboardInjected } from './WorkDashboard.tsx'
import { WorkDashboard } from './WorkDashboard.tsx'
import { en, NS, pt, zh, type WorkDashboardKey } from './locales.ts'

export type { WorkDashboardInjected, WorkDashboardProps } from './WorkDashboard.tsx'
export type { WorkDashboardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Leon Work dashboard copy. */
    'work-dashboard': WorkDashboardKey
  }
}

/** Services required by the dashboard plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

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
}
