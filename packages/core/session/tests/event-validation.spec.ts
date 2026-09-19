import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { type InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId, type SessionEvent } from '../src/index.ts'
import { installSessionEventValidation } from '../src/invariant.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'event-validation-test/value': { valid: boolean }
  }
}

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

function mount(ctx: Context, seen = vi.fn<(event: SessionEvent) => void>()): ReturnType<Context['plugin']> {
  const install = (child: Context, fail: InvariantFailure) =>
    installSessionEventValidation(child, (event) => {
      seen(event)
      if (event.type === 'event-validation-test/value' && typeof event.data.valid !== 'boolean') {
        fail('event-validation-test/value requires a boolean')
      }
    })
  return ctx.plugin(Object.assign((owner: Context) =>
    Promise.resolve(owner.invariants.register('event-validation-test', install)), { inject: ['invariants'] }))
}

describe('stateless session event validation lifecycle', () => {
  it('replays retained history and newly announced seeded sessions', async () => {
    const ctx = await setup()
    ctx.sessions.create().append('event-validation-test/value', { valid: true })
    const seen = vi.fn<(event: SessionEvent) => void>()
    await mount(ctx, seen)
    expect(seen.mock.calls.filter(([event]) => event.type === 'event-validation-test/value')).toHaveLength(1)
    const source = Session.create(SessionId('valid-source'))
    source.append('event-validation-test/value', { valid: false })
    ctx.sessions.create(undefined, { seed: source.events })
    expect(seen.mock.calls.filter(([event]) => event.type === 'event-validation-test/value')).toHaveLength(2)
    const count = seen.mock.calls.length
    ctx.emit('session/disposed', source)
    expect(seen).toHaveBeenCalledTimes(count)
  })

  it('rejects invalid history during registration and cleans up failed ownership', async () => {
    const ctx = await setup()
    const holder = await ctx.plugin(Object.assign((owner: Context) => {
      owner.sessions.create().append('event-validation-test/value', { valid: 'invalid' as unknown as boolean })
    }, { inject: ['sessions'] }))
    await expect(mount(ctx)).rejects.toThrow('event-validation-test/value requires a boolean')
    await holder.dispose()
    await expect(mount(ctx)).resolves.toBeDefined()
  })

  it('rejects an invalid creation seed and removes the unpublished session', async () => {
    const ctx = await setup()
    await mount(ctx)
    const source = Session.create(SessionId('invalid-source'))
    source.append('event-validation-test/value', { valid: 'invalid' as unknown as boolean })
    const id = SessionId('invalid-seed')
    expect(() => ctx.sessions.create(id, { seed: source.events })).toThrow('requires a boolean')
    expect(ctx.sessions.get(id)).toBeUndefined()
  })

  it('rejects before append or downstream observers, and removes hooks on disposal and reload', async () => {
    const ctx = await setup()
    const seen = vi.fn<(event: SessionEvent) => void>()
    const fiber = await mount(ctx, seen)
    const session = ctx.sessions.create()
    const committed = vi.fn()
    ctx.on('session/event', committed, { global: true })
    const before = session.events
    expect(() => session.append('event-validation-test/value', { valid: 'invalid' as unknown as boolean })).toThrow('requires a boolean')
    expect(session.events).toEqual(before)
    expect(committed).not.toHaveBeenCalled()
    await fiber.dispose()
    seen.mockClear()
    session.append('event-validation-test/value', { valid: true })
    expect(committed).toHaveBeenCalledOnce()
    expect(seen).not.toHaveBeenCalled()
    const reloaded = await mount(ctx, seen)
    expect(seen.mock.calls.filter(([event]) => event.type === 'event-validation-test/value')).toHaveLength(1)
    expect(() => session.append('event-validation-test/value', { valid: 'invalid' as unknown as boolean })).toThrow('requires a boolean')
    await reloaded.dispose()
    seen.mockClear()
    expect(() => session.append('event-validation-test/value', { valid: 'unprotected' as unknown as boolean })).not.toThrow()
    expect(seen).not.toHaveBeenCalled()
  })
})
