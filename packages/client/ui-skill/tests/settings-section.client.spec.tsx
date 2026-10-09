// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillSettingsSection, type SkillSettingsSectionProps } from '../src/client/SkillSettingsSection.tsx'
import type { SkillSettingsState } from '../src/client/settings-controller.ts'
import { en, pt, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: SkillSettingsState = {
  status: 'ready', agentPreset: 'leon', workspaceId: undefined, error: null, savingName: null,
  presets: [{ id: 'leon', name: 'Leon', trust: 'system', isDefault: true }, { id: 'custom', trust: 'user', isDefault: false }],
  catalog: {
    agentPreset: 'leon', complete: true, revision: 7, writable: true, disabledNames: ['review'],
    skills: [{ name: 'review', description: 'Revisão local', source: 'user', enabled: false, modelInvocable: false, userInvocable: true }],
  },
}

function mount(patch: Partial<SkillSettingsState> = {}) {
  const store = createSnapshotStore<SkillSettingsState>({ ...READY, ...patch })
  const workspaces = createSnapshotStore({ items: [{ workspaceId: 'project-a', title: 'Projeto A' }] })
  const actions = {
    load: vi.fn(async () => {}), selectPreset: vi.fn(async () => {}),
    selectWorkspace: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}),
  }
  const props = {
    ...actions, useSkillSettings: bindSnapshotSelector(store), useWorkspaces: bindSnapshotSelector(workspaces),
    t: makeTranslate(pt),
  } as unknown as SkillSettingsSectionProps
  render(<SkillSettingsSection {...props} />)
  return { actions, store, workspaces }
}

describe('Skills settings page', () => {
  it('shows installed disabled skills, invocation restrictions and an accessible toggle', () => {
    const { actions } = mount()
    expect(actions.load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy()
    expect(screen.getByText('Revisão local')).toBeTruthy()
    expect(screen.getByText('Origem: user')).toBeTruthy()
    expect(screen.getByText(/Invocação pelo modelo: Restrita/)).toBeTruthy()
    const control = screen.getByRole('switch', { name: 'review' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(actions.setEnabled).toHaveBeenCalledWith('review', true)
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('button', { name: /instalar/i })).toBeNull()
  })

  it('selects a profile and an existing workspace without entering a path', () => {
    const { actions } = mount()
    fireEvent.change(screen.getByLabelText('Perfil do agente'), { target: { value: 'custom' } })
    expect(actions.selectPreset).toHaveBeenCalledWith('custom')
    fireEvent.change(screen.getByLabelText('Workspace (opcional)'), { target: { value: 'project-a' } })
    expect(actions.selectWorkspace).toHaveBeenCalledWith('project-a')
    fireEvent.change(screen.getByLabelText('Workspace (opcional)'), { target: { value: '' } })
    expect(actions.selectWorkspace).toHaveBeenLastCalledWith(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('blocks writes and selection during saving, then shows only Host-confirmed state', () => {
    const { actions, store } = mount({ savingName: 'review' })
    expect(screen.getByRole('status').textContent).toBe('Salvando…')
    expect(screen.getByLabelText<HTMLSelectElement>('Perfil do agente').disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(actions.setEnabled).not.toHaveBeenCalled()
    act(() => { store.update((state) => {
      state.savingName = null
      state.catalog = { ...state.catalog!, skills: state.catalog!.skills.map(skill => ({ ...skill, enabled: true })) }
    }) })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Ativada')).toBeTruthy()
  })

  it('shows read-only, partial and empty observations independently', () => {
    mount({ catalog: { ...READY.catalog!, complete: false, writable: false, skills: [] } })
    expect(screen.getByText(pt['settings.incomplete'])).toBeTruthy()
    expect(screen.getByText(pt['settings.readOnly'])).toBeTruthy()
    expect(screen.getByText(pt['settings.emptyIncomplete'])).toBeTruthy()
    expect(screen.queryByText(pt['settings.empty'])).toBeNull()
  })

  it('distinguishes a confirmed empty catalog from an empty profile roster', () => {
    const { store } = mount({ catalog: { ...READY.catalog!, skills: [] } })
    expect(screen.getByText(pt['settings.empty'])).toBeTruthy()
    act(() => { store.update((state) => { state.presets = []; state.agentPreset = ''; state.catalog = undefined }) })
    expect(screen.getByText(pt['settings.noProfiles'])).toBeTruthy()
  })

  it('keeps a failed catalog read visible and controls disabled until refresh', () => {
    const { actions } = mount({ status: 'error', error: 'revision changed' })
    expect(screen.getByRole('alert').textContent).toContain('revision changed')
    fireEvent.click(screen.getByRole('switch'))
    expect(actions.setEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(actions.load).toHaveBeenCalledTimes(2)
  })

  it('announces loading and a removed workspace without silently selecting another', () => {
    const { store } = mount({ status: 'loading', workspaceId: 'removed' as never })
    expect(screen.getByRole('status').textContent).toBe(pt['settings.loading'])
    expect(screen.getByLabelText<HTMLSelectElement>('Workspace (opcional)').value).toBe('removed')
    expect(screen.getByText(pt['settings.workspaceMissing'])).toBeTruthy()
    act(() => { store.update((state) => { state.status = 'ready' }) })
    expect(screen.queryByText(pt['settings.loading'])).toBeNull()
  })

  it('ships complete Portuguese, English and Chinese dictionaries', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
