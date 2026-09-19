// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelAssignments } from '../src/client/ModelAssignments.tsx'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)
const view = (ns: string, value: unknown): SettingsNamespaceView => ({
  ns, value, schema: {}, applies: 'live', secrets: [], revision: 7,
})
function setup(writable = true, reasoningEffort?: string) {
  const update = vi.fn().mockResolvedValue({ result: { ok: true, value: {} } })
  const replace = vi.fn().mockResolvedValue({ result: { ok: true, value: {} } })
  const load = vi.fn().mockResolvedValue(undefined)
  const loadCatalog = vi.fn().mockResolvedValue(undefined)
  const api = { settings: { mutate: update, replace } } as unknown as Pick<IApiClient, 'settings'>
  const controller = { load, loadCatalog } as unknown as ModelsSettingsStore
  const state: ModelsSettingsState = {
    status: 'ready', error: null, credentialError: null, writable, rows: [],
    namespaces: new Map([
      ['agent-default-model', view('agent-default-model', { provider: 'llamacpp', model: 'small' })],
      ['agent-model-roles', view('agent-model-roles', { review: {
        provider: 'llamacpp', model: 'small', ...reasoningEffort === undefined ? {} : { reasoningEffort },
      } })],
    ]),
    catalog: [
      { id: 'llamacpp', name: 'Local', models: [{ id: 'small', name: 'Qwen pequeno' }] },
      { id: 'localhost-gateway', name: 'Gateway', models: [{ id: 'cloud', name: 'Externo', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] },
    ],
  }
  render(<ModelAssignments state={state} controller={controller} api={api} t={key => pt[key]} />)
  return { update, replace, load, loadCatalog }
}

it('requires explicit external consent even for a localhost gateway and writes only the selected role', async () => {
  const test = setup()
  const section = within(screen.getByRole('region', { name: pt.collaboration }))
  fireEvent.click(section.getAllByText(pt.roleChange)[1]!)
  fireEvent.change(section.getByLabelText(pt.roleProvider), { target: { value: 'localhost-gateway' } })
  const save = section.getByText(pt.roleSave) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  expect(test.update).not.toHaveBeenCalled()
  fireEvent.click(section.getByLabelText(pt.roleExternalConsent))
  fireEvent.change(section.getByLabelText(pt.roleEffort), { target: { value: 'low' } })
  fireEvent.click(save)
  await waitFor(() =>{  expect(test.load).toHaveBeenCalled() })
  expect(test.update).toHaveBeenCalledWith({ ns: 'agent-model-roles', expectedRevision: 7, ops: [{
    op: 'set', path: ['review'], value: { provider: 'localhost-gateway', model: 'cloud', reasoningEffort: 'low', allowExternal: true },
  }] })
  expect(test.replace).not.toHaveBeenCalled()
})

it('preserves an existing effort when the local catalog does not advertise reasoning controls', async () => {
  const test = setup(true, 'off')
  const section = within(screen.getByRole('region', { name: pt.collaboration }))
  const edit = section.getAllByText(pt.roleChange)[1]
  if (edit === undefined) throw new Error('Missing review editor')
  fireEvent.click(edit)
  const effort = section.getByLabelText(pt.roleEffort)
  if (!(effort instanceof HTMLSelectElement)) throw new Error('Missing reasoning effort select')
  expect(effort.value).toBe('off')
  expect(screen.queryByText(pt.roleMissing)).toBeNull()
  fireEvent.click(section.getByText(pt.roleSave))
  await waitFor(() =>{  expect(test.update).toHaveBeenCalledWith({ ns: 'agent-model-roles', expectedRevision: 7, ops: [{
    op: 'set', path: ['review'], value: { provider: 'llamacpp', model: 'small', reasoningEffort: 'off', allowExternal: false },
  }] }) })
})

it('clears the auxiliary section with revision control and does not change the main model', async () => {
  const test = setup()
  fireEvent.click(screen.getByText(pt.roleResetAll))
  await waitFor(() =>{  expect(test.replace).toHaveBeenCalledWith({ ns: 'agent-model-roles', section: {}, expectedRevision: 7 }) })
  expect(test.update).not.toHaveBeenCalled()
})

it('respects read-only settings and only refreshes the catalog without inference', async () => {
  const test = setup(false)
  const reset = screen.getByText(pt.roleResetAll)
  if (!(reset instanceof HTMLButtonElement)) throw new Error('Missing reset button')
  expect(reset.disabled).toBe(true)
  expect(screen.getAllByText(pt.roleChange).every(button => (button as HTMLButtonElement).disabled)).toBe(true)
  fireEvent.click(screen.getByText(pt.roleCatalog))
  expect(test.loadCatalog).toHaveBeenCalled()
  expect(test.update).not.toHaveBeenCalled()
})

it('surfaces a stale revision without claiming that the assignment was saved', async () => {
  const test = setup()
  test.update.mockResolvedValue({ result: { ok: false, error: { message: 'settings-conflict' } } })
  const section = within(screen.getByRole('region', { name: pt.collaboration }))
  fireEvent.click(section.getAllByText(pt.roleChange)[1]!)
  fireEvent.click(section.getByText(pt.roleSave))
  await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toBe('settings-conflict') })
  expect(screen.queryByText(pt.roleSaved)).toBeNull()
})
