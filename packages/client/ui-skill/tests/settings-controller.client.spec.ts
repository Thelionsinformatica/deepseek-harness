import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import { SkillSettingsController, type SkillSettingsState } from '../src/client/settings-controller.ts'

type Api = ConstructorParameters<typeof SkillSettingsController>[0]
type Catalog = NonNullable<SkillSettingsState['catalog']>

const row = { name: 'review', description: 'Local review', source: 'user', enabled: true, modelInvocable: false, userInvocable: true }
const catalog = (agentPreset = 'leon', overrides: Partial<Catalog> = {}): Catalog => ({
  agentPreset, complete: true, skills: [row], revision: 7, writable: true, disabledNames: ['absent-skill'], ...overrides,
})
const ok = <T>(value: T): RpcResponse<T> => ({ rpcId: RpcId('skill-settings-test'), result: { ok: true, value } })
const refusal = (message: string): RpcResponse<never> => ({
  rpcId: RpcId('skill-settings-test'),
  result: { ok: false, error: { message, code: 'settings-conflict', details: { ns: 'agent-presets', expected: 7, actual: 8 } } },
})
const saved = (): SettingsNamespaceView => ({
  ns: 'agent-presets', schema: {}, value: {}, applies: 'live', secrets: [], revision: 8,
})
const unexpected = (): Promise<never> => Promise.reject(new Error('Unexpected API method'))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const api = {
    agentPresets: { list: vi.fn<Api['agentPresets']['list']>(async () => ok({ presets: [
      { id: 'leon', name: 'Leon', isDefault: true, trust: 'system' },
      { id: 'standard', isDefault: false, trust: 'system' },
      { id: 'broken', isDefault: false, trust: 'user', broken: 'invalid config' },
    ], authorable: false, hasDocument: false })),
    select: unexpected, read: unexpected, copy: unexpected, openDocument: unexpected, remove: unexpected },
    skills: { catalog: vi.fn<Api['skills']['catalog']>(async ({ agentPreset }) => ok(catalog(agentPreset))),
      list: unexpected, inspect: unexpected },
    settings: { mutate: vi.fn<Api['settings']['mutate']>(async () => ok(saved())),
      describe: unexpected, openDocument: unexpected, update: unexpected, replace: unexpected },
  } satisfies Api
  const controller = new SkillSettingsController(api)
  return { api, controller, state: () => controller.store.getSnapshot() }
}

describe('profile skill settings', () => {
  it('loads the default profile without changing it or creating a session', async () => {
    const { api, controller, state } = setup()
    controller.refresh()
    expect(api.skills.catalog).not.toHaveBeenCalled()
    await controller.load()
    expect(api.skills.catalog).toHaveBeenCalledWith({ agentPreset: 'leon' }, expect.any(AbortSignal))
    expect(state()).toMatchObject({ status: 'ready', agentPreset: 'leon', catalog: { revision: 7 } })
    expect(api.settings.mutate).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('changes profile and optional workspace only through catalog ids', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    await controller.selectPreset('standard')
    await controller.selectWorkspace('work-a' as WorkspaceId)
    expect(api.skills.catalog).toHaveBeenLastCalledWith({ agentPreset: 'standard', workspaceId: 'work-a' }, expect.any(AbortSignal))
    await controller.selectWorkspace(undefined)
    expect(api.skills.catalog).toHaveBeenLastCalledWith({ agentPreset: 'standard' }, expect.any(AbortSignal))
    expect(state().agentPreset).toBe('standard')
    expect(api.settings.mutate).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('does not replace a new profile with an older catalog response', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    const stale = deferred<Awaited<ReturnType<Api['skills']['catalog']>>>()
    api.skills.catalog.mockImplementationOnce(() => stale.promise)
    const read = controller.load()
    await vi.waitFor(() => { expect(api.skills.catalog).toHaveBeenCalledTimes(2) })
    const previousSignal = api.skills.catalog.mock.calls[1]?.[1]
    await controller.selectPreset('standard')
    stale.resolve(ok(catalog('leon')))
    await read
    expect(previousSignal?.aborted).toBe(true)
    expect(state().catalog?.agentPreset).toBe('standard')
    await controller.dispose()
  })

  it('clears the previous catalog when a removed profile falls back to a healthy profile', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    api.agentPresets.list.mockResolvedValueOnce(ok({
      presets: [{ id: 'standard', isDefault: true, trust: 'system' }], authorable: false, hasDocument: false,
    }))
    const next = deferred<Awaited<ReturnType<Api['skills']['catalog']>>>()
    api.skills.catalog.mockReturnValueOnce(next.promise)
    const pending = controller.load()
    await vi.waitFor(() => { expect(api.skills.catalog).toHaveBeenCalledTimes(2) })
    expect(state()).toMatchObject({ status: 'loading', agentPreset: 'standard', catalog: undefined })
    next.resolve(ok(catalog('standard')))
    await pending
    expect(state().catalog?.agentPreset).toBe('standard')
    await controller.dispose()
  })

  it('persists a name using the observed revision, retaining absent disabled names', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    const write = deferred<Awaited<ReturnType<Api['settings']['mutate']>>>()
    api.settings.mutate.mockReturnValueOnce(write.promise)
    const pending = controller.setEnabled('review', false)
    expect(state()).toMatchObject({ savingName: 'review', catalog: { skills: [{ enabled: true }] } })
    expect(api.settings.mutate).toHaveBeenCalledWith({
      ns: 'agent-presets', expectedRevision: 7,
      ops: [{ op: 'set', path: ['disabledSkills', 'leon'], value: ['absent-skill', 'review'] }],
    })
    await controller.setEnabled('review', false)
    await controller.selectPreset('standard')
    await controller.selectWorkspace('other' as WorkspaceId)
    controller.refresh()
    expect(api.settings.mutate).toHaveBeenCalledTimes(1)
    expect(api.skills.catalog).toHaveBeenCalledTimes(1)
    api.skills.catalog.mockResolvedValueOnce(ok(catalog('leon', { revision: 8, skills: [{ ...row, enabled: false }], disabledNames: ['absent-skill', 'review'] })))
    write.resolve(ok(saved()))
    await pending
    expect(state()).toMatchObject({ savingName: null, catalog: { revision: 8, skills: [{ enabled: false }] } })
    await controller.dispose()
  })

  it('reenables without elevating invocation flags or removing other names', async () => {
    const { api, controller, state } = setup()
    api.skills.catalog.mockResolvedValueOnce(ok(catalog('leon', { skills: [{ ...row, enabled: false }], disabledNames: ['absent-skill', 'review'] })))
    await controller.load()
    await controller.setEnabled('review', true)
    expect(api.settings.mutate.mock.calls[0]?.[0]).toMatchObject({ ops: [{ value: ['absent-skill'] }] })
    expect(state().catalog?.skills[0]).toMatchObject({ enabled: true, modelInvocable: false, userInvocable: true })
    await controller.dispose()
  })

  it.each(['refusal', 'transport'])('shows a %s failure and refreshes without retrying the write', async (kind) => {
    const { api, controller, state } = setup()
    await controller.load()
    if (kind === 'refusal') api.settings.mutate.mockResolvedValueOnce(refusal('revision changed'))
    else api.settings.mutate.mockRejectedValueOnce(new Error('connection lost'))
    await controller.setEnabled('review', false)
    expect(state().error).toBe(kind === 'refusal' ? 'revision changed' : 'connection lost')
    expect(state().catalog?.skills[0]?.enabled).toBe(true)
    expect(api.settings.mutate).toHaveBeenCalledTimes(1)
    expect(api.skills.catalog).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('shows a failed verification read instead of claiming the preference was saved', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    api.skills.catalog.mockRejectedValueOnce(new Error('catalog offline'))
    await controller.setEnabled('review', false)
    expect(state()).toMatchObject({ status: 'error', savingName: null, error: 'catalog offline' })
    await controller.dispose()
  })

  it('keeps a partial catalog partial and permits only authoritative writable rows', async () => {
    const { api, controller, state } = setup()
    api.skills.catalog.mockResolvedValueOnce(ok(catalog('leon', { complete: false, writable: false })))
    await controller.load()
    await controller.setEnabled('review', false)
    expect(state().catalog).toMatchObject({ complete: false, writable: false })
    expect(api.settings.mutate).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('does not write missing rows, unchanged values, or select invalid profiles', async () => {
    const { api, controller } = setup()
    await controller.setEnabled('review', false)
    await controller.load()
    await controller.setEnabled('review', true)
    await controller.setEnabled('unknown', false)
    await controller.selectPreset('broken')
    await controller.selectPreset('unknown')
    await controller.selectPreset('leon')
    await controller.selectWorkspace(undefined)
    expect(api.settings.mutate).not.toHaveBeenCalled()
    expect(api.skills.catalog).toHaveBeenCalledTimes(1)
    await controller.dispose()
  })

  it('reports an empty roster without a catalog request', async () => {
    const { api, controller, state } = setup()
    api.agentPresets.list.mockResolvedValueOnce(ok({ presets: [], authorable: false, hasDocument: false }))
    await controller.load()
    expect(state()).toMatchObject({ status: 'ready', agentPreset: '', catalog: undefined })
    expect(api.skills.catalog).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it.each(['roster', 'catalog'])('reports a refused %s read', async (where) => {
    const { api, controller, state } = setup()
    if (where === 'roster') api.agentPresets.list.mockResolvedValueOnce(refusal('read denied'))
    else api.skills.catalog.mockResolvedValueOnce(refusal('read denied'))
    await controller.load()
    expect(state()).toMatchObject({ status: 'error', error: 'read denied' })
    await controller.dispose()
  })

  it('aborts and awaits pending observations without late publication after disposal', async () => {
    const { api, controller, state } = setup()
    const read = deferred<Awaited<ReturnType<Api['agentPresets']['list']>>>()
    api.agentPresets.list.mockReturnValueOnce(read.promise)
    const pending = controller.load()
    const before = state()
    const disposal = controller.dispose()
    read.resolve(ok({ presets: [{ id: 'leon', isDefault: true, trust: 'system' }], authorable: false, hasDocument: false }))
    await Promise.all([pending, disposal])
    expect(state()).toBe(before)
    expect(api.skills.catalog).not.toHaveBeenCalled()
    await controller.load()
    await controller.selectPreset('standard')
    await controller.selectWorkspace('work' as WorkspaceId)
    await controller.setEnabled('review', false)
    expect(api.agentPresets.list).toHaveBeenCalledTimes(1)
  })

  it('waits for an already dispatched write, without a reload after disposal', async () => {
    const { api, controller, state } = setup()
    await controller.load()
    const write = deferred<Awaited<ReturnType<Api['settings']['mutate']>>>()
    api.settings.mutate.mockReturnValueOnce(write.promise)
    const pending = controller.setEnabled('review', false)
    const before = state()
    let disposed = false
    const disposal = controller.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    write.resolve(ok(saved()))
    await Promise.all([pending, disposal])
    expect(state()).toBe(before)
    expect(api.skills.catalog).toHaveBeenCalledTimes(1)
  })
})
