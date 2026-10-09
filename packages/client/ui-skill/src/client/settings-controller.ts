/** Profile skill preferences: Host-confirmed catalog reads and revision-fenced writes. */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

type SuccessValue<T> = T extends { result: infer R } ? R extends { ok: true; value: infer V } ? V : never : never
type SkillSettingsApi = Pick<IApiClient, 'skills' | 'agentPresets' | 'settings'>
type Catalog = SuccessValue<Awaited<ReturnType<IApiClient['skills']['catalog']>>>
type Roster = SuccessValue<Awaited<ReturnType<IApiClient['agentPresets']['list']>>>

/** Observable view of the selected profile's installed skills. */
export interface SkillSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  presets: Roster['presets']
  agentPreset: string
  workspaceId: WorkspaceId | undefined
  catalog: Catalog | undefined
  savingName: string | null
  error: string | null
}

/** Owns pending catalog reads and writes until plugin disposal. */
export class SkillSettingsController {
  /** Read-only observable injected into the Settings section. */
  readonly store = createSnapshotStore<SkillSettingsState>({
    status: 'idle', presets: [], agentPreset: '', workspaceId: undefined,
    catalog: undefined, savingName: null, error: null,
  })

  private disposed = false
  private readAbort: AbortController | undefined
  private readonly pending = new Set<Promise<void>>()

  /** @param api - Host catalog, preset roster, and revision-aware Settings methods. */
  constructor(private readonly api: SkillSettingsApi) {}

  private live(abort?: AbortController): boolean {
    return !this.disposed && abort?.signal.aborted !== true
  }

  private own(operation: Promise<void>): Promise<void> {
    this.pending.add(operation)
    void operation.finally(() => { this.pending.delete(operation) }).catch(() => {})
    return operation
  }

  /** Refresh an already opened page after a settings commit or reconnect. */
  refresh(): void {
    if (this.store.getSnapshot().status !== 'idle') void this.load()
  }

  /** @returns settlement after the latest roster and catalog observation. */
  load(): Promise<void> {
    if (this.disposed || this.store.getSnapshot().savingName !== null) return Promise.resolve()
    this.readAbort?.abort()
    const abort = new AbortController()
    this.readAbort = abort
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    return this.own(this.read(abort))
  }

  private async read(abort: AbortController): Promise<void> {
    try {
      const roster = await this.api.agentPresets.list({}, abort.signal)
      if (!this.live(abort)) return
      if (!roster.result.ok) throw new Error(roster.result.error.message)
      const presets = roster.result.value.presets
      const healthy = presets.filter(preset => preset.broken === undefined)
      const current = this.store.getSnapshot()
      const agentPreset = healthy.find(preset => preset.id === current.agentPreset)?.id
        ?? healthy.find(preset => preset.isDefault)?.id ?? healthy[0]?.id ?? ''
      this.store.update((state) => {
        state.presets = presets
        if (state.agentPreset !== agentPreset) state.catalog = undefined
        state.agentPreset = agentPreset
      })
      if (agentPreset === '') {
        this.store.update((state) => { state.status = 'ready'; state.catalog = undefined })
        return
      }
      const response = await this.api.skills.catalog({
        agentPreset,
        ...(current.workspaceId === undefined ? {} : { workspaceId: current.workspaceId }),
      }, abort.signal)
      if (!this.live(abort)) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const catalog = response.result.value
      this.store.update((state) => {
        state.catalog = catalog
        state.status = 'ready'
      })
    } catch (error) {
      if (!this.live(abort)) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Select a profile to inspect, without changing the deployment default or any session.
   * @param agentPreset - an existing healthy roster id.
   * @returns settlement of its catalog read.
   */
  selectPreset(agentPreset: string): Promise<void> {
    const state = this.store.getSnapshot()
    if (this.disposed || state.savingName !== null || agentPreset === state.agentPreset
      || !state.presets.some(preset => preset.id === agentPreset && preset.broken === undefined)) return Promise.resolve()
    this.store.update((draft) => { draft.agentPreset = agentPreset; draft.catalog = undefined })
    return this.load()
  }

  /**
   * Include an existing workspace's project skills in the catalog; policy remains profile-wide.
   * @param workspaceId - Host workspace id, or undefined for profile/user roots only.
   * @returns settlement of the scoped catalog read.
   */
  selectWorkspace(workspaceId: WorkspaceId | undefined): Promise<void> {
    const state = this.store.getSnapshot()
    if (this.disposed || state.savingName !== null || workspaceId === state.workspaceId) return Promise.resolve()
    this.store.update((draft) => { draft.workspaceId = workspaceId; draft.catalog = undefined })
    return this.load()
  }

  /**
   * Persist one profile-wide name preference, retaining hidden or currently absent disabled names.
   * @param name - a skill in the observed catalog.
   * @param enabled - the requested availability; invocation restrictions remain Host-owned.
   * @returns settlement after the Host write and authoritative catalog refresh.
   */
  setEnabled(name: string, enabled: boolean): Promise<void> {
    const state = this.store.getSnapshot()
    const catalog = state.catalog
    const skill = catalog?.skills.find(item => item.name === name)
    if (this.disposed || state.status !== 'ready' || state.savingName !== null
      || catalog === undefined || !catalog.writable || skill === undefined || skill.enabled === enabled) return Promise.resolve()
    const disabledNames = enabled
      ? catalog.disabledNames.filter(item => item !== name)
      : [...new Set([...catalog.disabledNames, name])]
    this.store.update((draft) => { draft.savingName = name; draft.error = null })
    return this.own(this.write(catalog, disabledNames))
  }

  private async write(catalog: Catalog, disabledNames: string[]): Promise<void> {
    let failure: string | null = null
    try {
      const response = await this.api.settings.mutate({
        ns: 'agent-presets', expectedRevision: catalog.revision,
        ops: [{ op: 'set', path: ['disabledSkills', catalog.agentPreset], value: disabledNames }],
      })
      if (!response.result.ok) failure = response.result.error.message
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (!this.live()) return
    this.store.update((state) => { state.savingName = null })
    // Refusals and uncertain transport outcomes also refresh; never retry a write implicitly.
    await this.load()
    if (!this.live()) return
    if (failure !== null && this.store.getSnapshot().agentPreset === catalog.agentPreset) {
      this.store.update((state) => { state.error = failure })
    }
  }

  /** Abort observations and await in-flight writes without publishing after disposal. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.readAbort?.abort()
    await Promise.allSettled([...this.pending])
  }
}
