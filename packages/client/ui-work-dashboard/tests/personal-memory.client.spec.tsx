// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryAdminItem } from '@deepseek-ai/dsh-tool-memory/types'
import { PersonalMemoryPanel } from '../src/client/PersonalMemoryPanel.tsx'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)

const sessionId = 'personal-panel-session' as SessionId

function item(content = 'Prefiro respostas diretas.', revision = 1): MemoryAdminItem {
  return {
    id: 'personal-memory-one' as MemoryAdminItem['id'],
    revision,
    content,
    redacted: false,
    status: 'active',
    sourceSessionId: sessionId,
    validation: 'explicit',
    createdAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
  }
}

describe('Leon personal-memory panel', () => {
  it('confirms additions, corrections, disabling, and forgetting while keeping deletion available', async () => {
    const listPersonalMemories = vi.fn(() => Promise.resolve({
      items: [item()],
      hasMore: false,
      nextOffset: 1,
      readOnly: false,
      enabled: true,
    }))
    const rememberPersonalMemory = vi.fn((
      _sessionId: SessionId,
      content: string,
    ) => Promise.resolve({ ...item(content), id: 'personal-memory-two' as MemoryAdminItem['id'] }))
    const correctPersonalMemory = vi.fn((
      _sessionId: SessionId,
      _current: MemoryAdminItem,
      content: string,
    ) => Promise.resolve(item(content, 2)))
    const forgetPersonalMemory = vi.fn(() => Promise.resolve())
    const setPersonalMemoryEnabled = vi.fn((
      _sessionId: SessionId,
      enabled: boolean,
    ) => Promise.resolve(enabled))

    render(<PersonalMemoryPanel
      sessionId={sessionId}
      listPersonalMemories={listPersonalMemories}
      rememberPersonalMemory={rememberPersonalMemory}
      correctPersonalMemory={correctPersonalMemory}
      forgetPersonalMemory={forgetPersonalMemory}
      setPersonalMemoryEnabled={setPersonalMemoryEnabled}
      t={makeTranslate(pt)}
    />)

    await screen.findByText('Prefiro respostas diretas.')
    expect(listPersonalMemories).toHaveBeenCalledWith(sessionId, undefined)

    fireEvent.change(screen.getByLabelText(pt['memory.personal.addLabel']), {
      target: { value: 'Uso o servidor alfa diariamente.' },
    })
    fireEvent.click(screen.getByRole('button', { name: pt['memory.personal.reviewAdd'] }))
    expect(rememberPersonalMemory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => {
      expect(rememberPersonalMemory).toHaveBeenCalledWith(sessionId, 'Uso o servidor alfa diariamente.')
    })

    fireEvent.click(screen.getAllByRole('button', { name: pt['memory.saved.correct'] })[0]!)
    fireEvent.change(screen.getByLabelText(pt['memory.personal.editLabel']), {
      target: { value: 'Prefiro respostas curtas e diretas.' },
    })
    fireEvent.click(screen.getByRole('button', { name: pt['memory.saved.reviewCorrection'] }))
    expect(correctPersonalMemory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => {
      expect(correctPersonalMemory).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ revision: 1 }),
        'Prefiro respostas curtas e diretas.',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: pt['memory.personal.disable'] }))
    expect(setPersonalMemoryEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => { expect(setPersonalMemoryEnabled).toHaveBeenCalledWith(sessionId, false) })
    expect(screen.getByText(pt['memory.personal.disabledDetail'])).toBeTruthy()
    expect(screen.getByLabelText(pt['memory.personal.addLabel']).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getAllByRole('button', { name: pt['memory.saved.forget'] })[0]!)
    fireEvent.click(screen.getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => { expect(forgetPersonalMemory).toHaveBeenCalledTimes(1) })
  })

  it('offers a retry after a loading failure', async () => {
    const listPersonalMemories = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], hasMore: false, nextOffset: 0, readOnly: false, enabled: true })
    render(<PersonalMemoryPanel
      sessionId={sessionId}
      listPersonalMemories={listPersonalMemories}
      rememberPersonalMemory={vi.fn()}
      correctPersonalMemory={vi.fn()}
      forgetPersonalMemory={vi.fn()}
      setPersonalMemoryEnabled={vi.fn()}
      t={makeTranslate(pt)}
    />)

    expect((await screen.findByRole('alert')).textContent).toContain(pt['memory.personal.error'])
    fireEvent.click(screen.getByRole('button', { name: pt['memory.retry'] }))
    await waitFor(() => { expect(listPersonalMemories).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(pt['memory.personal.empty'])).toBeTruthy()
  })
})
