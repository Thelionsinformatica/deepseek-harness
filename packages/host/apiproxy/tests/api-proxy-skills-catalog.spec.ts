import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { AgentPresetSettingsSchema, UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'

class MemorySettings extends SettingsProvider {
  readonly doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(this.doc) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const ns = settingsNamespace('agent-presets')
function request(agentPreset = 'leon', workspaceId?: string) {
  return { rpcId: RpcId('catalog-test'), payload: { agentPreset, ...workspaceId === undefined ? {} : { workspaceId } } }
}

async function harness(withSettings = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SkillRegistry)
  if (withSettings) await ctx.plugin(MemorySettings)
  const settings = ctx.get('settings')
  const section = settings?.register(ns, AgentPresetSettingsSchema, { base: { default: 'leon' } })
  const scope = { preset: 'leon' }
  const presetCtx = createScope(ctx, scope).ctx
  presetCtx.get('skills')!.registerRestriction(name => !section?.get().disabledSkills?.leon?.includes(name))
  const standingKeyFor = vi.fn(async (id: string) => {
    if (id !== 'leon') throw new UnknownPresetError(id, ['leon'])
    return scope
  })
  const serviceForPreset = vi.fn(async () => ctx.get('skills'))
  ctx.provide('agentPresets', { standingKeyFor, serviceForPreset } as never)
  const factory = {
    createAgent: vi.fn(() => { throw new Error('catalog must not create agents') }),
    resume: vi.fn(() => { throw new Error('catalog must not resume agents') }),
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, { cwd: '/host-default-must-not-be-used', defaultModelSelection: () => ({ provider: 'test', model: 'test' }) })
  return { ctx, api, settings, scope, presetCtx, factory, standingKeyFor, serviceForPreset }
}

function register(ctx: Context, name: string, source = 'bundled', modelInvocable = true) {
  ctx.get('skills')!.register({
    name, description: `Skill ${name}`, content: 'PRIVATE BODY', path: '/private/SKILL.md',
    resourceBase: { kind: 'directory', path: '/private' }, source,
    invocation: { modelInvocable, userInvocable: true },
  })
}

describe('skill.catalog', () => {
  it('includes disabled metadata and unseen disabled names without creating a session or agent', async () => {
    const { ctx, api, settings, presetCtx, factory, standingKeyFor, serviceForPreset } = await harness()
    register(presetCtx, 'disabled')
    register(presetCtx, 'user-only', 'C:/private/provider', false)
    register(createScope(ctx, { other: true }).ctx, 'other-preset')
    await settings!.mutate(ns, [{ op: 'set', path: ['disabledSkills', 'leon'], value: ['disabled', 'not-installed'] }])
    const response = await api.skills.catalog(request())
    expect(response.result).toEqual({ ok: true, value: {
      agentPreset: 'leon', complete: true, revision: 1, writable: true, disabledNames: ['disabled', 'not-installed'],
      skills: [
        { name: 'disabled', description: 'Skill disabled', source: 'bundled', enabled: false, modelInvocable: false, userInvocable: false },
        { name: 'user-only', description: 'Skill user-only', source: 'custom', enabled: true, modelInvocable: false, userInvocable: true },
      ],
    } })
    expect(JSON.stringify(response)).not.toMatch(/PRIVATE|private|other-preset|resourceBase/)
    expect(standingKeyFor).toHaveBeenCalledTimes(2)
    expect(standingKeyFor).toHaveBeenLastCalledWith('leon')
    expect(serviceForPreset).toHaveBeenCalledExactlyOnceWith('leon', 'skills')
    expect(ctx.sessions.list()).toEqual([])
    expect(factory.createAgent).not.toHaveBeenCalled()
    expect(factory.resume).not.toHaveBeenCalled()
  })

  it('resolves only registered workspace paths and leaves cwd unset when none is selected', async () => {
    const { ctx, api, scope } = await harness()
    const inventory = vi.spyOn(ctx.get('skills')!, 'inventory')
    const get = vi.fn((id: string) => id === 'known' ? { path: '/registered/workspace' } : undefined)
    ctx.provide('workspaceRegistry', { get } as never)
    await api.skills.catalog(request())
    expect(inventory).toHaveBeenLastCalledWith({ cwd: undefined, scope })
    await api.skills.catalog(request('leon', 'known'))
    expect(inventory).toHaveBeenLastCalledWith({ cwd: '/registered/workspace', scope })
    const missing = await api.skills.catalog(request('leon', '/arbitrary/path'))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
    expect(inventory).toHaveBeenCalledTimes(2)
  })

  it('reads the preset service rather than an unrelated host registry', async () => {
    const { ctx, api, serviceForPreset } = await harness()
    register(ctx, 'host-only')
    const realm = new Context()
    await realm.plugin(SkillRegistry)
    register(realm, 'realm-only')
    serviceForPreset.mockResolvedValue(realm.get('skills'))
    expect((await api.skills.catalog(request())).result).toMatchObject({ ok: true, value: { skills: [{ name: 'realm-only' }] } })
  })

  it('rejects unknown presets without falling back to the host catalog', async () => {
    const { ctx, api, serviceForPreset } = await harness()
    register(ctx, 'host-only')
    expect((await api.skills.catalog(request('missing'))).result).toMatchObject({ ok: false, error: { code: 'agent-preset-not-found' } })
    expect(serviceForPreset).not.toHaveBeenCalled()
  })

  it('reports incomplete discovery and a read-only catalog when settings are absent', async () => {
    const { ctx, api } = await harness(false)
    vi.spyOn(ctx.get('skills')!, 'inventory').mockResolvedValue({ complete: false, skills: [] })
    expect((await api.skills.catalog(request())).result).toEqual({ ok: true, value: {
      agentPreset: 'leon', complete: false, skills: [], revision: 0, writable: false, disabledNames: [],
    } })
  })

  it('rejects a catalog that races a settings commit instead of returning a fresh CAS revision', async () => {
    const { ctx, api, settings } = await harness()
    vi.spyOn(ctx.get('skills')!, 'inventory').mockImplementation(async () => {
      await settings!.mutate(ns, [{ op: 'set', path: ['disabledSkills', 'leon'], value: ['changed'] }])
      return { complete: true, skills: [] }
    })
    expect((await api.skills.catalog(request())).result).toMatchObject({ ok: false, error: { message: 'skill settings changed during catalog discovery; retry the catalog' } })
  })

  it('uses the returned revision for existing settings.mutate and rejects a stale edit', async () => {
    const { api } = await harness()
    const catalog = await api.skills.catalog(request())
    if (!catalog.result.ok) throw new Error('expected catalog')
    const mutation = { rpcId: RpcId('edit'), payload: { ns: 'agent-presets', expectedRevision: catalog.result.value.revision,
      ops: [{ op: 'set' as const, path: ['disabledSkills', 'leon'], value: ['disabled'] }],
    } }
    expect((await api.settings.mutate(mutation)).result.ok).toBe(true)
    expect((await api.settings.mutate(mutation)).result).toMatchObject({ ok: false, error: { code: 'settings-conflict' } })
  })

  it('rejects a standing generation change during catalog discovery', async () => {
    const { api, standingKeyFor, scope } = await harness()
    standingKeyFor.mockResolvedValueOnce(scope).mockResolvedValueOnce({ preset: 'leon' })
    expect((await api.skills.catalog(request())).result).toMatchObject({ ok: false, error: {
      message: 'agent preset changed during skill discovery; retry the catalog',
    } })
  })

  it('redacts provider and standing-mount failures', async () => {
    const { ctx, api, standingKeyFor, serviceForPreset } = await harness()
    vi.spyOn(ctx.get('skills')!, 'inventory').mockRejectedValue(new Error('/private/provider'))
    const failed = await api.skills.catalog(request())
    expect(failed.result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(failed)).not.toContain('/private')
    standingKeyFor.mockRejectedValueOnce(new Error('/private/preset'))
    expect(JSON.stringify(await api.skills.catalog(request()))).not.toContain('/private')
    serviceForPreset.mockResolvedValue(undefined)
    expect((await api.skills.catalog(request())).result).toMatchObject({ ok: false, error: { message: 'skill registry is absent from the requested preset composition' } })
  })
})
