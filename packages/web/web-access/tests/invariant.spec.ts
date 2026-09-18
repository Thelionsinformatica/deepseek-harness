import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as WebAccessInvariant from '../src/invariant.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
})

async function context(): Promise<Context> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

describe('web access event invariant', () => {
  it.each([0, 'yes', null])('refuses %j before persistent state and downstream notification', async (invalid) => {
    const ctx = await context()
    await ctx.plugin(WebAccessInvariant)
    const session = ctx.sessions.create()
    const observed = vi.fn()
    ctx.on('session/event', observed, { global: true })
    expect(() => session.append('web/access', { enabled: invalid as unknown as boolean })).toThrow('expected a boolean')
    expect(session.events).toEqual([])
    expect(observed).not.toHaveBeenCalled()
    session.append('web/access', { enabled: true })
    session.append('web/access', { enabled: false })
    expect(observed).toHaveBeenCalledTimes(2)
  })

  it('validates history during late registration and creation, and removes its checks on disposal', async () => {
    const ctx = await context()
    const valid = ctx.sessions.create()
    valid.append('web/access', { enabled: true })
    const fiber = await ctx.plugin(WebAccessInvariant)
    const seed = Session.create(SessionId('bad-web-seed'))
    seed.append('web/access', { enabled: 'bad' as unknown as boolean })
    expect(() => ctx.sessions.create(undefined, { seed: seed.events })).toThrow('expected a boolean')
    await fiber.dispose()
    valid.append('web/access', { enabled: 'bad' as unknown as boolean })
    await expect(ctx.plugin(WebAccessInvariant)).rejects.toThrow('expected a boolean')
  })
})
