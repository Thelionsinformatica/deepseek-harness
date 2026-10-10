/**
 * Explicit, session-scoped user control for native public web tools.
 *
 * The controller is intentionally independent of file-sandbox and global
 * approval presets. A user can grant search and public HTTP fetch for this
 * session without broadening filesystem or process permissions. The grant is
 * durable in the session log, immediately revocable, and consumed only by the
 * web egress approval guard.
 *
 * @module @deepseek-ai/dsh-web-access
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { WebAccessProjection } from './types.ts'

export type * from './types.ts'

/** Human command used by the browser control and advanced command menu. */
export const WEB_ACCESS_COMMAND = 'web'

/** Validate both the durable event and the client projection. */
const webAccessSchema = z.object({ enabled: z.boolean() })

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-session explicit authorization for native public web tools. */
    webAccess: WebAccessService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-change state of the explicit native web-access grant. */
    'web/access': WebAccessProjection
  }
}

/**
 * Host-plane controller for one explicit user-controlled web-access grant.
 * It does not contact the web itself and does not alter global approvals.
 */
export class WebAccessService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'webAccess')

    // The projection is the single state source for the guard and the client.
    ctx.sessionProjections.register({
      key: 'webAccess',
      stateVersion: 1,
      stateSchema: webAccessSchema,
      init: () => ({ enabled: false }),
      apply: (state, event) => event.type === 'web/access' ? webAccessSchema.parse(event.data) : state,
      wire: { viewSchema: webAccessSchema, view: state => state },
    })

    // The command is host-owned so one browser control works for every session.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(() => commandCtx.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-web-access'),
        name: WEB_ACCESS_COMMAND,
        description: 'Enable or revoke native public web access for this session',
        input: { hint: '<on|off>' },
        handler: ({ agent, rawInput }) => Promise.resolve(this.command(agent.session, rawInput)),
      }), 'web-access command')
    })
  }

  /**
   * Read the effective durable grant for one session.
   * @param session - session whose event history owns the decision.
   * @returns whether native web tools may skip their per-call approval.
   */
  isEnabled(session: Session): boolean {
    return this.ctx.sessionProjections.stateOf(session, 'webAccess')?.enabled ?? false
  }

  /**
   * Change the complete session-scoped grant. Repeating the current value is
   * intentionally a no-op so the durable log remains an audit of decisions.
   * @param session - session whose user decision changes.
   * @param enabled - next complete grant state.
   * @returns true only when a new durable event was appended.
   */
  set(session: Session, enabled: boolean): boolean {
    if (this.isEnabled(session) === enabled) return false
    session.append('web/access', { enabled })
    return true
  }

  private command(session: Session, rawInput: string): { kind: 'success'; text: string } | { kind: 'error'; text: string } {
    const action = rawInput.trim().toLowerCase()
    if (action === '') {
      return {
        kind: 'success',
        text: this.isEnabled(session) ? 'Web access is enabled for this session.' : 'Web access is disabled for this session.',
      }
    }
    if (action !== 'on' && action !== 'off') return { kind: 'error', text: 'usage: /web <on|off>' }
    const enabled = action === 'on'
    if (!this.set(session, enabled)) {
      return {
        kind: 'success',
        text: enabled ? 'Web access is already enabled for this session.' : 'Web access is already disabled for this session.',
      }
    }
    return {
      kind: 'success',
      text: enabled
        ? 'Web access enabled for this session. Native web searches and public fetches no longer need per-call approval.'
        : 'Web access disabled for this session. Future native web calls require approval again.',
    }
  }
}

export default WebAccessService
