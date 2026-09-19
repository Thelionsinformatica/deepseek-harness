// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { TechnicalContextRow } from '../src/client/settings/TechnicalContextRow.tsx'
import type { TechnicalContextRowProps } from '../src/client/settings/TechnicalContextRow.tsx'
import { TechnicalContextPolicy } from '../src/client/settings/technical-context-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function mount() {
  const policy = new TechnicalContextPolicy()
  const setTechnicalContextVisible = vi.fn((visible: boolean) => { policy.setVisible(visible) })
  const props: TechnicalContextRowProps = {
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })),
    useTechnicalContextVisible: bindSnapshotSelector(policy.visible),
    setTechnicalContextVisible,
    t: makeTranslate(en),
  }
  render(<TechnicalContextRow {...props} />)
  return { setTechnicalContextVisible }
}

describe('TechnicalContextRow', () => {
  it('explains the preference and is hidden by default', () => {
    mount()
    expect(screen.getByText('Technical context in chat')).toBeDefined()
    expect(screen.getByText(/Show prompt preparation events/)).toBeDefined()
    expect(screen.getByRole('button', { name: /Hidden/ })).toBeDefined()
  })

  it('allows technical details to be shown again', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Hidden/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shown' }))
    expect(b.setTechnicalContextVisible).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /Shown/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hidden' }))
    expect(b.setTechnicalContextVisible).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: /Hidden/ })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Hidden/ }))
    expect(screen.getByRole('menuitem', { name: 'Shown' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Shown' })).toBeNull()
  })
})
