// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  setEnabled: PluginInventorySettingsTabInjected['setEnabled'] = async () => SNAPSHOT.entries[0]!,
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    setEnabled,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    {
      entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active',
      category: 'extension', summary: 'Reloads browser plugin bundles.', capabilities: ['plugin lifecycle'],
      activation: 'live-toggle', activationReason: 'Audited optional capability. Change reverts on restart.',
    },
    {
      entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending',
      category: 'other', summary: 'Configured Cordis plugin.', capabilities: ['plugin lifecycle'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
    {
      entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading',
      category: 'other', summary: 'Configured Cordis plugin.', capabilities: ['plugin lifecycle'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
    {
      entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed',
      category: 'other', summary: 'Configured Cordis plugin.', capabilities: ['plugin lifecycle'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
    {
      entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading',
      category: 'other', summary: 'Configured Cordis plugin.', capabilities: ['plugin lifecycle'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
    {
      entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null,
      category: 'other', summary: 'Configured Cordis plugin.', capabilities: ['plugin lifecycle'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
    {
      entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null,
      category: 'host-runtime', summary: 'Supports the local host runtime.', capabilities: ['host runtime'],
      activation: 'restart-required', activationReason: 'Restart after configuration change.',
    },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders operational detail and exposes the narrow live control only for audited entries', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    expect(screen.getByText(en.liveToggle)).toBeTruthy()
    expect(screen.getAllByText(en.restartRequired)).toHaveLength(6)
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled, Live toggle' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    expect(screen.getByText(en.purpose)).toBeTruthy()
    expect(screen.getByText(en.capabilities)).toBeTruthy()
    expect(screen.getByText(en.management)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.disableNow })).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled, Restart required' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
    expect(screen.queryByRole('button', { name: en.enableNow })).toBeNull()
  })

  it('updates the displayed plugin only from the Host result and contains a failed live toggle', async () => {
    const updated = {
      ...SNAPSHOT.entries[0]!,
      enabled: false,
      fiberPhase: null,
    } as Snapshot['entries'][number]
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockResolvedValueOnce(updated)
      .mockRejectedValueOnce(new Error('host refused this plugin'))
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, setEnabled)} />)
    const active = await screen.findByRole('button', { name: 'hmr, Mounted, Enabled, Live toggle' })
    fireEvent.click(active)
    fireEvent.click(screen.getByRole('button', { name: en.disableNow }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('8a1b2c3d', false) })
    expect(await screen.findByRole('button', { name: 'hmr, Disabled, Live toggle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.enableNow })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.enableNow }))
    expect((await screen.findByRole('status')).textContent).toBe(en.actionError)
    expect(screen.queryByText('host refused this plugin')).toBeNull()
  })

  it('filters by module name, entry id, purpose, or capability', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'browser interface' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.change(search, { target: { value: 'plugin lifecycle' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(6)

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
