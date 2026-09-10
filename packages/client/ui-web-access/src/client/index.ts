/** Register the explicit session Web-access control in the composer. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-web-access/client'
import { WebAccessControl } from './WebAccessControl.tsx'
import { en, NS, pt, zh, type WebAccessKey } from './locales.ts'

export type { WebAccessKey } from './locales.ts'
export type { WebAccessControlProps } from './WebAccessControl.tsx'

/** Merge the control's copy into the shared locale contract. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Explicit session Web-access control copy. */
    'web-access': WebAccessKey
  }
}

/** Injected business face for one session's composer button. */
export interface WebAccessControlInjected {
  /** Change the host-owned, session-scoped public web permission. */
  toggleWebAccess: (enabled: boolean) => Promise<string | null>
}

/** Required services: conversation list seat, command Remote, locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Browser plugin body. It only executes the typed human command: the host
 * projection remains the source of truth and remains absent on surfaces where
 * the host controller is not composed.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { pt, zh, en }), 'ui-web-access: dictionaries')
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'web-access',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): WebAccessControlInjected => ({
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
