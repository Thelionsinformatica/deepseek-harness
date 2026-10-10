/** Durable session access state, command wiring, and projection lifecycle. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebAccessService from '../src/index.ts'

async function harness(options: { commands?: boolean } = {}): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (options.commands !== false) await ctx.plugin(CommandRuntime)
  await ctx.plugin(WebAccessService)
  return { ctx, session: ctx.sessions.create(SessionId('web-access-session')) }
}

/** The command runtime reads only these members of the invoking agent. */
function agentFor(session: Session): Agent {
  return { session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as Agent
}

async function run(ctx: Context, session: Session, line: string) {
  return (await ctx.commands.execute(agentFor(session), line, [], new AbortController().signal))?.result
}

describe('WebAccessService', () => {
  it('starts disabled and folds the latest complete decision through the projection', async () => {
    const { ctx, session } = await harness()
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
    expect(ctx.sessionProjections.snapshot(session).values.webAccess).toEqual({ enabled: false })

    expect(ctx.webAccess.set(session, true)).toBe(true)
    expect(ctx.webAccess.set(session, true)).toBe(false)
    expect(ctx.webAccess.isEnabled(session)).toBe(true)
    expect(ctx.webAccess.set(session, false)).toBe(true)
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
    expect(ctx.sessionProjections.snapshot(session).values.webAccess).toEqual({ enabled: false })
  })

  it('registers the projection only while the controller is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('web-access-hmr'))
    expect('webAccess' in ctx.sessionProjections.snapshot(session).values).toBe(false)

    const fiber = await ctx.plugin(WebAccessService)
    expect(ctx.sessionProjections.snapshot(session).values.webAccess).toEqual({ enabled: false })
    await fiber.dispose()
    expect('webAccess' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })

  it('switches with /web on and /web off', async () => {
    const { ctx, session } = await harness()
    expect(await run(ctx, session, '/web on')).toEqual({
      kind: 'success',
      text: 'Web access enabled for this session. Native web searches and public fetches no longer need per-call approval.',
    })
    expect(ctx.webAccess.isEnabled(session)).toBe(true)
    expect(await run(ctx, session, '/web off')).toEqual({
      kind: 'success',
      text: 'Web access disabled for this session. Future native web calls require approval again.',
    })
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
  })

  it('reports its state and rejects ambiguous input without changing the grant', async () => {
    const { ctx, session } = await harness()
    expect(await run(ctx, session, '/web')).toEqual({ kind: 'success', text: 'Web access is disabled for this session.' })
    expect(await run(ctx, session, '/web always')).toEqual({ kind: 'error', text: 'usage: /web <on|off>' })
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
  })

  it('works without the command runtime', async () => {
    const { ctx, session } = await harness({ commands: false })
    expect(ctx.webAccess.set(session, true)).toBe(true)
    expect(ctx.webAccess.isEnabled(session)).toBe(true)
  })
})
