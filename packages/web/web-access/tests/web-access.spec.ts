/** Durable session access state, command wiring, and projection lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebAccessService, { foldWebAccess } from '../src/index.ts'

async function harness(options: { projection?: boolean; commands?: boolean } = {}): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (options.projection !== false) await ctx.plugin(SessionProjectionRegistry)
  if (options.commands !== false) await ctx.plugin(CommandRuntime)
  await ctx.plugin(WebAccessService)
  return { ctx, session: ctx.sessions.create(SessionId('web-access-session')) }
}

/** Mint the scoped agent form used by the command Remote. */
async function agentFor(ctx: Context, session: Session): Promise<Agent> {
  const agent = { id: session.id, session, inject: vi.fn<Agent['inject']>() } as unknown as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return agent
}

describe('WebAccessService', () => {
  it('starts disabled, emits complete audited decisions, and folds the latest decision only', async () => {
    const { ctx, session } = await harness()
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
    expect(ctx.sessionProjections.snapshot(session).values.webAccess).toEqual({ enabled: false })

    expect(ctx.webAccess.set(session, true)).toBe(true)
    expect(ctx.webAccess.set(session, true)).toBe(false)
    expect(ctx.webAccess.set(session, false)).toBe(true)
    expect(session.events.filter(event => event.type === 'web/access').map(event => event.data)).toEqual([
      { enabled: true }, { enabled: false },
    ])
    expect(foldWebAccess(session.events)).toBe(false)
    expect(ctx.sessionProjections.snapshot(session).values.webAccess).toEqual({ enabled: false })
  })

  it('registers a session-scoped projection only while the controller is composed', async () => {
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

  it('uses /web on and /web off without changing unrelated permission knobs', async () => {
    const { ctx, session } = await harness()
    const agent = await agentFor(ctx, session)

    expect((await ctx.commands.execute(agent, '/web on', [], new AbortController().signal))?.result).toEqual({
      kind: 'success',
      text: 'Web access enabled for this session. Native web searches and public fetches no longer need per-call approval.',
    })
    expect(ctx.webAccess.isEnabled(session)).toBe(true)
    expect((await ctx.commands.execute(agent, '/web off', [], new AbortController().signal))?.result).toEqual({
      kind: 'success',
      text: 'Web access disabled for this session. Future native web calls require approval again.',
    })
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
    expect(session.events.filter(event => event.type === 'web/access')).toHaveLength(2)
    expect(session.events.some(event => event.type === 'sandbox/mode' || event.type === 'approval/policy')).toBe(false)
  })

  it('reports its current state and rejects ambiguous commands without changing the grant', async () => {
    const { ctx, session } = await harness()
    const agent = await agentFor(ctx, session)

    expect((await ctx.commands.execute(agent, '/web', [], new AbortController().signal))?.result).toEqual({
      kind: 'success', text: 'Web access is disabled for this session.',
    })
    expect((await ctx.commands.execute(agent, '/web always', [], new AbortController().signal))?.result).toEqual({
      kind: 'error', text: 'usage: /web <on|off>',
    })
    expect(ctx.webAccess.isEnabled(session)).toBe(false)
    expect(session.events.filter(event => event.type === 'web/access')).toHaveLength(0)
  })

  it('remains useful headlessly when commands and projections are absent', async () => {
    const { ctx, session } = await harness({ projection: false, commands: false })
    expect(ctx.webAccess.set(session, true)).toBe(true)
    expect(ctx.webAccess.isEnabled(session)).toBe(true)
  })
})
