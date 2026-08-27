// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { pt, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const tPt: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (pt as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

const useSession: ComponentProps<typeof ModelSelect>['useSession'] = selector => selector({
  running: false,
  nodes: [],
} as unknown as ConversationSnapshot)

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    automatic: false,
    automaticAvailable: false,
    externalFailoverConsent: false,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('refreshes the corner model indicator when automatic failover lands', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      automatic: true,
      automaticAvailable: true,
    }))
    const session = createSnapshotStore<ConversationSnapshot>({
      running: true,
      nodes: [],
    } as unknown as ConversationSnapshot)
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={load}
      select={vi.fn().mockResolvedValue(true)}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={bindSnapshotSelector(session)}
      t={t}
    />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })

    act(() => {
      session.set({
        ...session.getSnapshot(),
        nodes: [{
          kind: 'model-failover', seq: 7, time: 7_000, turn: 1, step: 0,
          from: { provider: 'ollama', model: 'qwen3.5:9b' },
          to: { provider: 'google', model: 'gemini-3.6-flash' },
          failure: { code: 'TRANSPORT', message: 'connection refused' },
          reason: 'provider-unavailable',
        }],
      })
    })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(3) })
  })

  it('offers Leon Automatic and shows the local route currently in use', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({ automaticAvailable: true }))
    const selectAutomatic = vi.fn(async () => {
      directory.set(state({
        automatic: true,
        automaticAvailable: true,
        current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      selectAutomatic={selectAutomatic}
      useSession={useSession}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型，当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Leon 自动/ }))
    expect(screen.getByRole('menuitemcheckbox', { name: /允许通过 API 使用外部备用模型/ })
      .getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitem', { name: '启用 Leon 自动模式' }))
    await waitFor(() => {
      expect(selectAutomatic).toHaveBeenCalledWith(false)
      expect(screen.getByRole('button', {
        name: 'Leon 自动模式，当前使用 DeepSeek-V4-Flash，推理等级 Low',
      }).textContent).toContain('DeepSeek-V4-Flash · Low')
    })
  })

  it('warns in Brazilian Portuguese before permitting external API fallback', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({ automaticAvailable: true }))
    const selectAutomatic = vi.fn(async (externalConsent: boolean) => {
      directory.set(state({
        automatic: true,
        automaticAvailable: true,
        externalFailoverConsent: externalConsent,
      }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      selectAutomatic={selectAutomatic}
      useSession={useSession}
      t={tPt}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Selecionar modelo, atual/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Modelo/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Leon Automático/ }))

    const consent = screen.getByRole('menuitemcheckbox', { name: /Permitir fallback por API/ })
    expect(consent.getAttribute('aria-checked')).toBe('false')
    expect(consent.textContent).toContain(
      'Pode enviar o contexto desta conversa a um provedor externo e gerar custos de API. Desligado por padrão.',
    )
    fireEvent.click(consent)
    expect(consent.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ativar Leon Automático' }))

    await waitFor(() => { expect(selectAutomatic).toHaveBeenCalledWith(true) })
    expect(directory.getSnapshot().externalFailoverConsent).toBe(true)
  })

  it('reflects the external fallback consent returned by the Host', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      automatic: true,
      automaticAvailable: true,
      externalFailoverConsent: true,
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={tPt}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Leon Automático, usando agora/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Modelo/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Leon Automático/ }))
    expect(screen.getByRole('menuitemcheckbox', { name: /Permitir fallback por API/ })
      .getAttribute('aria-checked')).toBe('true')
  })

  it('turns automatic mode and its external consent off when the current model is selected manually', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      automatic: true,
      automaticAvailable: true,
      externalFailoverConsent: true,
    }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection, automaticAvailable: true }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={tPt}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Leon Automático, usando agora/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Modelo/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' }))

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
      })
    })
    expect(directory.getSnapshot()).toMatchObject({
      automatic: false,
      externalFailoverConsent: false,
    })
  })

  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'Low', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      selectAutomatic={vi.fn().mockResolvedValue(true)}
      useSession={useSession}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      selectAutomatic={vi.fn().mockResolvedValue(false)}
      useSession={useSession}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
