import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SkillRegistry, { type SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import { bindScopeParent, createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { CallId } from '@deepseek-ai/dsh-llm'
import { UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'

async function harness(withSkills = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withSkills) await ctx.plugin(SkillRegistry)
  const factory = {
    createAgent: vi.fn(() => { throw new Error('inspection must not create agents') }),
    resume: vi.fn(() => { throw new Error('inspection must not resume agents') }),
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    cwd: '/workspace',
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
  })
  return { ctx, api, factory }
}

function attach(ctx: Context, id = 'inspect', preset?: string): Session {
  return ctx.sessions.create(SessionId(id), {
    meta: { cwd: '/workspace', ...preset === undefined ? {} : { agentPreset: preset } },
  })
}

function liveAgent(ctx: Context, session: Session, parent?: ScopeKey): Agent {
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  if (parent !== undefined) bindScopeParent(agent, parent)
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  ctx.agents.register(agent)
  return agent
}

function registerSkill(ctx: Context, name: string, invocation: SkillInvocationPolicy = { modelInvocable: true, userInvocable: true }, source = 'runtime') {
  ctx.get('skills')?.register({
    name,
    description: `Description for ${name}`,
    content: 'PRIVATE SKILL BODY',
    path: '/private/skills/SKILL.md',
    resourceBase: { kind: 'directory', path: '/private/skills' },
    source,
    invocation,
  })
}

function skillTool(ctx: Context) {
  const tool = defineContentToolFixture({
    name: 'skill', description: 'Load a skill', parameters: {},
    async execute() { throw new Error('inspection must not invoke tools') },
  })
  ctx.get('tools')?.register(tool)
  return ctx.get('skills')?.registerModelTool(tool)
}

function inspectRequest(sessionId = 'inspect') {
  return { rpcId: RpcId('inspect-test'), payload: { sessionId: SessionId(sessionId) } }
}

describe('skill.inspect', () => {
  it('returns only the current agent catalog with independent model and user permissions', async () => {
    const { ctx, api, factory } = await harness()
    const session = attach(ctx, 'inspect', 'original')
    session.append('agent-preset/selected', { agentPreset: 'selected' })
    const agent = liveAgent(ctx, session)
    const unrelated = createScope(ctx, { preset: 'other' })
    registerSkill(ctx, 'global-skill')
    registerSkill(agent.ctx, 'model-only', { modelInvocable: true, userInvocable: false })
    registerSkill(agent.ctx, 'user-only', { modelInvocable: false, userInvocable: true })
    registerSkill(unrelated.ctx, 'foreign-skill')
    skillTool(ctx)

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected inspection')
    expect(response.result.value).toMatchObject({
      agentPreset: 'selected', complete: true, modelToolAvailable: true, authorization: 'not-evaluated',
      skills: [
        { name: 'global-skill', modelInvocable: true, userInvocable: true, source: 'runtime' },
        { name: 'model-only', modelInvocable: true, userInvocable: false },
        { name: 'user-only', modelInvocable: false, userInvocable: true },
      ],
    })
    expect(Date.parse(response.result.value.observedAt)).not.toBeNaN()
    expect(JSON.stringify(response)).not.toMatch(/PRIVATE|\/private|foreign-skill|resourceBase/)
    expect(factory.createAgent).not.toHaveBeenCalled()
    expect(factory.resume).not.toHaveBeenCalled()
  })

  it('does not evaluate execution guards or infer permission from a visible loader', async () => {
    const { ctx, api } = await harness()
    const agent = liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'guarded-skill')
    skillTool(ctx)
    const guard = vi.fn(() => 'policy denies this skill invocation')
    agent.ctx.get('tools')?.guard(guard)

    const inspection = await api.skills.inspect(inspectRequest())

    expect(guard).not.toHaveBeenCalled()
    expect(inspection.result).toMatchObject({ ok: true, value: {
      complete: true, modelToolAvailable: true, authorization: 'not-evaluated',
      skills: [{ name: 'guarded-skill', modelInvocable: true }],
    } })
    const execution = await ctx.get('tools')!.execute({
      callId: CallId('guarded-skill-attempt'), name: 'skill', arguments: {}, agent,
      signal: new AbortController().signal,
    })
    expect(guard).toHaveBeenCalledOnce()
    expect(execution.isError).toBe(true)
    expect(execution.content).toEqual([{ type: 'text', text: 'Error: policy denies this skill invocation' }])
  })

  it('honors live tool restrictions without hiding a user-invocable skill', async () => {
    const { ctx, api } = await harness()
    const agent = liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'usable-by-user')
    skillTool(ctx)
    agent.ctx.get('tools')?.restrict({ deny: ['skill'] })

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: {
      agentPreset: null, complete: true, modelToolAvailable: false,
      skills: [{ name: 'usable-by-user', modelInvocable: false, userInvocable: true }],
    } })
  })

  it('does not advertise a same-named shadow tool as the skill loader', async () => {
    const { ctx, api } = await harness()
    const agent = liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'known-skill')
    skillTool(ctx)
    agent.ctx.get('tools')?.register(defineContentToolFixture({
      name: 'skill', description: 'Unrelated shadow', parameters: {},
      async execute() { return [] },
    }))

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: {
      complete: true, modelToolAvailable: false,
      skills: [{ name: 'known-skill', modelInvocable: false, userInvocable: true }],
    } })
  })

  it('reports a disposed loader registration as unavailable even if a same-named tool remains', async () => {
    const { ctx, api } = await harness()
    liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'known-skill')
    const disposeLoader = skillTool(ctx)
    disposeLoader?.()

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: {
      complete: true, modelToolAvailable: false, skills: [{ modelInvocable: false }],
    } })
  })

  it('reports custom source labels without exposing private provider locations', async () => {
    const { ctx, api } = await harness()
    liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'private-source', { modelInvocable: true, userInvocable: true }, 'C:\\private\\skills')

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: { skills: [{ source: 'custom' }] } })
    expect(JSON.stringify(response)).not.toContain('C:\\private')
  })

  it('uses the latest preset standing scope for an attached cold session but does not claim live availability', async () => {
    const { ctx, api, factory } = await harness()
    const oldKey = { preset: 'old' }
    const selectedKey = { preset: 'selected' }
    registerSkill(createScope(ctx, oldKey).ctx, 'old-only')
    registerSkill(createScope(ctx, selectedKey).ctx, 'selected-only')
    skillTool(ctx)
    const standingKeyFor = vi.fn(async (id: string) => {
      if (id !== 'selected') throw new Error('stale preset selected')
      return selectedKey
    })
    ctx.provide('agentPresets', { standingKeyFor } as never)
    const session = attach(ctx, 'inspect', 'old')
    session.append('agent-preset/selected', { agentPreset: 'selected' })
    const before = [...session.events]

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: {
      agentPreset: 'selected', complete: false, modelToolAvailable: false,
      skills: [{ name: 'selected-only', modelInvocable: false, userInvocable: true }],
    } })
    expect(standingKeyFor).toHaveBeenCalledExactlyOnceWith('selected')
    expect(session.events).toEqual(before)
    expect(ctx.agents.get(session.id)).toBeUndefined()
    expect(factory.createAgent).not.toHaveBeenCalled()
    expect(factory.resume).not.toHaveBeenCalled()
  })

  it('retains partial discovery as incomplete even when the live skill tool is available', async () => {
    const { ctx, api } = await harness()
    liveAgent(ctx, attach(ctx))
    registerSkill(ctx, 'observed-skill')
    skillTool(ctx)
    const registry = ctx.get('skills')!
    const original = registry.snapshot.bind(registry)
    vi.spyOn(registry, 'snapshot').mockImplementation(async options => ({ ...await original(options), complete: false }))

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: true, value: {
      complete: false, modelToolAvailable: true, skills: [{ name: 'observed-skill', modelInvocable: true }],
    } })
  })

  it('rejects unattached sessions and absent registries with distinct errors', async () => {
    const { ctx, api, factory } = await harness(false)
    const missing = await api.skills.inspect(inspectRequest('not-attached'))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    attach(ctx)
    const absent = await api.skills.inspect(inspectRequest())
    expect(absent.result).toMatchObject({ ok: false, error: { code: 'internal' } })
    if (absent.result.ok) throw new Error('expected missing registry')
    expect(absent.result.error.message).toContain('skill registry is absent')
    expect(factory.resume).not.toHaveBeenCalled()
  })

  it('does not fall back to a different catalog when the recorded preset cannot be resolved', async () => {
    const { ctx, api } = await harness()
    registerSkill(ctx, 'global-skill')
    attach(ctx, 'inspect', 'gone')
    ctx.provide('agentPresets', {
      standingKeyFor: () => Promise.reject(new UnknownPresetError('gone', ['other'])),
    } as never)

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: false, error: { code: 'agent-preset-not-found' } })
    expect(JSON.stringify(response)).not.toContain('global-skill')
  })

  it('rejects an observation that raced with a preset change', async () => {
    const { ctx, api } = await harness()
    const session = attach(ctx, 'inspect', 'old')
    liveAgent(ctx, session)
    vi.spyOn(ctx.get('skills')!, 'snapshot').mockImplementation(async () => {
      session.append('agent-preset/selected', { agentPreset: 'new' })
      return { complete: true, skills: [] }
    })

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
    if (response.result.ok) throw new Error('expected changed composition')
    expect(response.result.error.message).toContain('composition changed')
  })

  it('withholds private locations when discovery fails', async () => {
    const { ctx, api } = await harness()
    liveAgent(ctx, attach(ctx))
    vi.spyOn(ctx.get('skills')!, 'snapshot').mockRejectedValue(new Error('failed /private/skills/SKILL.md'))

    const response = await api.skills.inspect(inspectRequest())

    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(response)).not.toContain('/private')
  })
})
