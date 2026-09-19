import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { createApiRemoteAgentResolver } from '@deepseek-ai/dsh-api-remotes'
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

const sid = (value: string): SessionId => value as SessionId

function header(id: SessionId): SessionHeader {
  return { version: 0, id, createdAt: 1, cwd: '/proj' }
}

const deleting = (sessionId: SessionId) => ({
  code: 'session-not-found' as const,
  message: `session "${sessionId}" is being deleted`,
  details: { sessionId },
})

async function createContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

function provideSession(
  ctx: Context,
  meta: SessionHeader,
  inspect: () => Promise<{ meta: SessionHeader; events: SessionEvent[] }>,
): void {
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([meta]),
    inspect,
    locate: () => undefined,
  } as never)
}

function stubAgent(ctx: Context, session: Session): Agent {
  return { id: session.id, session, status: 'idle', ctx } as Agent
}

describe('API Remote Agent resolver races', () => {
  it('applies an initial lifecycle guard and exposes the same settled resolution to its owner', async () => {
    const ctx = await createContext()
    const sessionId = sid('guarded-before-resume')
    const inspect = vi.fn()
    const onResolution = vi.fn()
    provideSession(ctx, header(sessionId), inspect)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const resolve = createApiRemoteAgentResolver(ctx, {
      guard: id => deleting(id),
      onResolution,
    })

    const result = await resolve(sessionId)

    expect(result).toEqual({ error: deleting(sessionId) })
    expect(inspect).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(onResolution).toHaveBeenCalledOnce()
    await expect(onResolution.mock.calls[0]?.[1]).resolves.toEqual(result)
    await ctx.fiber.dispose()
  })

  it('rechecks the lifecycle guard after inspection and refuses a pending cold resume', async () => {
    const ctx = await createContext()
    const sessionId = sid('guarded-during-inspect')
    const meta = header(sessionId)
    let enterInspect!: () => void
    let releaseInspect!: () => void
    let closed = false
    const inspectEntered = new Promise<void>((resolve) => { enterInspect = resolve })
    const inspectReleased = new Promise<void>((resolve) => { releaseInspect = resolve })
    provideSession(ctx, meta, async () => {
      enterInspect()
      await inspectReleased
      return { meta, events: [] }
    })
    const resume = vi.spyOn(ctx.agents, 'resume')
    const resolve = createApiRemoteAgentResolver(ctx, {
      guard: id => closed ? deleting(id) : undefined,
    })

    const resolution = resolve(sessionId)
    await inspectEntered
    closed = true
    releaseInspect()

    await expect(resolution).resolves.toEqual({ error: deleting(sessionId) })
    expect(resume).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('disposes a just-published cold Agent when the lifecycle guard closes during handle transfer', async () => {
    const ctx = await createContext()
    const sessionId = sid('guarded-after-publication')
    const meta = header(sessionId)
    let published: Session | undefined
    let closed = false
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const dispose = vi.fn(() => Promise.resolve())
    vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(ctx, published), dispose }
    })
    const resolve = createApiRemoteAgentResolver(ctx, {
      guard: id => closed ? deleting(id) : undefined,
      onHandle: () => { closed = true },
    })

    await expect(resolve(sessionId)).resolves.toEqual({ error: deleting(sessionId) })
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('applies the lifecycle guard to the Typert Agent Host Context lookup', async () => {
    const ctx = await createContext()
    const sessionId = sid('guarded-typert-context')
    const defaultProvider = ctx.typert.contexts.getHost('agent')
    createApiRemoteAgentResolver(ctx, { guard: id => deleting(id) })
    await vi.waitFor(() => { expect(ctx.typert.contexts.getHost('agent')).not.toBe(defaultProvider) })
    const provider = ctx.typert.contexts.getHost('agent')
    if (provider === undefined) throw new Error('Agent Host Context provider was not mounted')

    const resolution = provider.resolve(sessionId)
    await expect(resolution).rejects.toBeInstanceOf(TypertLookupFailure)
    await expect(resolution).rejects.toMatchObject({
      failure: { code: 'session-not-found', details: { sessionId } },
    })
    await ctx.fiber.dispose()
  })

  it('transfers the exact cold-resume AgentHandle once across concurrent lookups', async () => {
    const ctx = await createContext()
    const sessionId = sid('retained-cold-handle')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const dispose = vi.fn(() => Promise.resolve())
    const handle = {
      get agent() {
        if (published === undefined) throw new Error('Session was not published')
        return stubAgent(ctx, published)
      },
      dispose,
    }
    vi.spyOn(ctx.agents, 'resume').mockResolvedValue(handle)
    const onHandle = vi.fn()
    const resolve = createApiRemoteAgentResolver(ctx, { onHandle })

    const [first, second] = await Promise.all([resolve(sessionId), resolve(sessionId)])
    expect(first).toMatchObject({ agent: { id: sessionId } })
    expect(second).toMatchObject({ agent: { id: sessionId } })
    expect(onHandle).toHaveBeenCalledOnce()
    expect(onHandle).toHaveBeenCalledWith(handle)
    expect(dispose).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('disposes a cold handle when ownership transfer rejects', async () => {
    const ctx = await createContext()
    const sessionId = sid('rejected-handle-transfer')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const dispose = vi.fn(() => Promise.resolve())
    vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(ctx, published), dispose }
    })
    const resolve = createApiRemoteAgentResolver(ctx, {
      onHandle: () => { throw new Error('owner refused handle') },
    })

    const result = await resolve(sessionId)
    expect(result).toMatchObject({ error: { code: 'internal' } })
    if (!('error' in result)) throw new Error('ownership rejection unexpectedly returned an Agent')
    expect(result.error.message).toContain('owner refused handle')
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('maps an inspected session without a cwd to session-not-found', async () => {
    const ctx = await createContext()
    const sessionId = sid('missing-after-inspect')
    const meta = header(sessionId)
    provideSession(ctx, meta, () => Promise.resolve({
      meta: { ...meta, cwd: undefined } as unknown as SessionHeader,
      events: [],
    }))

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ error: { code: 'session-not-found', details: { sessionId } } })
    await ctx.fiber.dispose()
  })

  it('resumes through a concurrently attached ordinary Session without optional defaults', async () => {
    const ctx = await createContext()
    const sessionId = sid('ordinary-attach-race')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(ctx, published), dispose: () => Promise.resolve() }
    })

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ agent: { id: sessionId } })
    expect(resume).toHaveBeenCalledWith({ resumeSessionId: sessionId })
    await ctx.fiber.dispose()
  })

  it('rejects a subagent Session published after durable inspection', async () => {
    const ctx = await createContext()
    const sessionId = sid('owned-attach-race')
    const meta = header(sessionId)
    provideSession(ctx, meta, () => {
      ctx.sessions.create(sessionId, { meta: { cwd: '/proj', origin: 'subagent' } })
      return Promise.resolve({ meta, events: [] })
    })
    const resume = vi.spyOn(ctx.agents, 'resume')

    const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

    expect(result).toMatchObject({ error: { code: 'agent-busy' } })
    expect(resume).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reclassifies failed resumes after a live or attached subagent wins publication', async () => {
    for (const winner of ['agent', 'session'] as const) {
      const ctx = await createContext()
      const sessionId = sid(`owned-${winner}-resume-race`)
      const meta = header(sessionId)
      provideSession(ctx, meta, () => Promise.resolve({ meta, events: [] }))
      vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
        const session = ctx.sessions.create(sessionId, { meta: { cwd: '/proj', origin: 'subagent' } })
        if (winner === 'agent') ctx.agents.register(stubAgent(ctx, session))
        throw new Error('session id already published')
      })

      const result = await createApiRemoteAgentResolver(ctx, {})(sessionId)

      expect(result).toMatchObject({ error: { code: 'agent-busy' } })
      await ctx.fiber.dispose()
    }
  })

  it('uses the shared cold-resume policy for the Agent Host Context', async () => {
    const ctx = await createContext()
    const sessionId = sid('context-cold-resume')
    const meta = header(sessionId)
    let published: Session | undefined
    provideSession(ctx, meta, () => {
      published = ctx.sessions.create(sessionId, { meta: { cwd: '/proj' } })
      return Promise.resolve({ meta, events: [] })
    })
    const agentCtx = ctx.extend()
    vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      if (published === undefined) throw new Error('Session was not published')
      return { agent: stubAgent(agentCtx, published), dispose: () => Promise.resolve() }
    })
    const defaultProvider = ctx.typert.contexts.getHost('agent')
    createApiRemoteAgentResolver(ctx, {})
    await vi.waitFor(() => { expect(ctx.typert.contexts.getHost('agent')).not.toBe(defaultProvider) })
    const provider = ctx.typert.contexts.getHost('agent')
    if (provider === undefined) throw new Error('Agent Host Context provider was not mounted')

    await expect(provider.resolve(sessionId)).resolves.toBe(agentCtx)
    await ctx.fiber.dispose()
  })

  it('applies the subagent ownership fence to the Agent Host Context', async () => {
    const ctx = await createContext()
    const sessionId = sid('context-owned-subagent')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/proj', origin: 'subagent' } })
    ctx.agents.register(stubAgent(ctx.extend(), session))
    const defaultProvider = ctx.typert.contexts.getHost('agent')
    createApiRemoteAgentResolver(ctx, {})
    await vi.waitFor(() => { expect(ctx.typert.contexts.getHost('agent')).not.toBe(defaultProvider) })
    const provider = ctx.typert.contexts.getHost('agent')
    if (provider === undefined) throw new Error('Agent Host Context provider was not mounted')

    const resolution = provider.resolve(sessionId)
    await expect(resolution).rejects.toBeInstanceOf(TypertLookupFailure)
    await expect(resolution).rejects.toMatchObject({ failure: { code: 'agent-busy' } })
    await ctx.fiber.dispose()
  })
})
