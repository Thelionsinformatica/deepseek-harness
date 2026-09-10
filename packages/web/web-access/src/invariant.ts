/** Package-owned invariant for explicit web-access session events. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-access'

/** Cordis companion plugin name. */
export const name = 'web-access-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Reject malformed durable access decisions before they become projection state. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'web/access') return
  if (typeof event.data.enabled !== 'boolean') {
    fail(`web/access carries invalid enabled state ${JSON.stringify(event.data.enabled)}; expected a boolean`)
  }
}

/** Install validation for retained history and newly appended events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const validateSession = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) validateSession(session)
  ctx.on('session/created', validateSession, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the invariant under this package's durable ownership key. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
