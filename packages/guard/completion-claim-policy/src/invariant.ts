/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-completion-claim-policy`.
 * @module @deepseek-ai/dsh-completion-claim-policy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './task-acceptance.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-completion-claim-policy'

/** Cordis companion plugin name. */
export const name = 'completion-claim-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validation decisions must name an admitted task and a response in the same open turn. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: (message: string) => never) => {
  const check = (prefix: readonly SessionEvent[], event: SessionEvent): void => {
    if (event.type !== 'task/validation') return
    const { messageId, responseId, turn, attempt, status, reason } = event.data
    const start = prefix.findLastIndex(e => e.type === 'turn/start' && e.data.turn === turn)
    const tail = prefix.slice(start + 1)
    if (start < 0 || tail.some(e => e.type === 'turn/end')) fail('task/validation requires its open turn')
    if (!tail.some(e => e.type === 'user/message' && e.data.id === messageId && 'acceptance' in e.data.source)) {
      fail('task/validation has no matching task criteria')
    }
    if (!tail.some(e => e.type === 'assistant/message' && e.data.message.id === responseId && e.data.turn === turn)) {
      fail('task/validation has no matching assistant response')
    }
    const prior = tail.filter(e => e.type === 'task/validation' && e.data.messageId === messageId)
    if (attempt !== prior.length + 1 || prior.some(e => e.type === 'task/validation' && e.data.responseId === responseId)) {
      fail('task/validation repeats a response or resets the attempt counter')
    }
    if (!['passed', 'retry', 'failed'].includes(status)
      || !['matched', 'output-mismatch', 'read-missing'].includes(reason)
      || (status === 'passed') !== (reason === 'matched')) fail('task/validation has inconsistent status and reason')
  }
  const existing = (session: Session): void => {
    for (const event of session.events) check(session.events.slice(0, event.seq), event)
  }
  for (const session of ctx.sessions.list()) existing(session)
  ctx.on('session/created', existing, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    check(session.events, event)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
