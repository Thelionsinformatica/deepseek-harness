/** Shared lifecycle wiring for stateless, package-owned session event validators. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from './index.ts'

/**
 * Validate retained histories, announced sessions and candidate events before dispatch commits them.
 * A nested child owns the sessions injection and listeners; disposal follows the registration.
 * This helper holds no projection state; validators must be synchronous and side-effect free.
 * @param ctx Owning invariant registration context.
 * @param validate Owner-supplied validator that throws its bound invariant failure on rejection.
 * @returns Setup completion after sessions is available and retained history has been validated.
 */
export function installSessionEventValidation(ctx: Context, validate: (event: SessionEvent) => void): Promise<void> {
  return Promise.resolve(ctx.plugin(Object.assign((child: Context) => {
    const validateSession = (session: Session): void => {
      for (const event of session.events) validate(event)
    }
    for (const session of child.sessions.list()) validateSession(session)
    child.on('session/created', validateSession, { global: true })
    child.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [, event] = args as [Session, SessionEvent]
      validate(event)
    }, { global: true })
  }, { inject: ['sessions'] }))).then(() => undefined)
}
