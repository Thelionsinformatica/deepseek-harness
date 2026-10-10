/** Register the explicit session Web-access control in the composer. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `webAccess` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-web-access/client'
import { WebAccessControl } from './WebAccessControl.tsx'
import { en, NS, zh, type WebAccessKey } from './locales.ts'

export type { WebAccessKey } from './locales.ts'
export type { WebAccessControlProps } from './WebAccessControl.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Explicit session Web-access control copy. */
    'web-access': WebAccessKey
  }
}

/** Injected business face for one session's composer button. */
export interface WebAccessControlInjected {
  /** Change the host-owned, session-scoped public web permission; resolves to a failure message or null. */
  toggleWebAccess: (enabled: boolean) => Promise<string | null>
}

/** Required services: slot registry, command Remote, locale registry. */
export const inject = ['slots', 'remote', 'locale']

/**
 * Browser plugin body. It only executes the human command: the host projection
 * remains the source of truth, and the control stays hidden where the host
 * controller is not composed.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web-access: dictionaries')
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'web-access',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): WebAccessControlInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      toggleWebAccess: async (enabled) => {
        const line = enabled ? '/web on' : '/web off'
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${line}`
        if (result.value.result.kind === 'error') return result.value.result.text
        return null
      },
    }),
  }, WebAccessControl))
}
