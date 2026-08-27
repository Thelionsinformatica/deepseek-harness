// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryCandidateId, MemoryCandidateReviewItem } from '@deepseek-ai/dsh-tool-memory/types'
import type { MemoryAdminItem } from '@deepseek-ai/dsh-tool-memory/types'
import {
  MemoryReviewButton,
  type MemoryReviewButtonProps,
} from '../src/client/MemoryReviewButton.tsx'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)

const sessionId = 'session-one' as SessionId
const candidateId = (value: string): MemoryCandidateId => value as MemoryCandidateId

function candidate(
  overrides: Partial<MemoryCandidateReviewItem> = {},
  includeContent = true,
  includeCategory = true,
): MemoryCandidateReviewItem {
  return {
    id: candidateId('candidate-one'),
    sessionId,
    operation: 'message_candidate',
    ...(includeContent ? { candidateContent: 'O usuário prefere respostas diretas.' } : {}),
    ...(includeCategory ? { category: 'preference' as const } : {}),
    confidence: 0.94,
    importance: 0.8,
    sensitivity: 'none',
    policyVersion: 1,
    policyDecision: 'store',
    policyReason: 'high-confidence',
    reviewed: false,
    createdAt: '2026-08-25T11:00:00.000Z',
    ...overrides,
  }
}

function memory(overrides: Partial<MemoryAdminItem> = {}, includeContent = true): MemoryAdminItem {
  return {
    id: 'memory-one' as MemoryAdminItem['id'],
    revision: 1,
    ...(includeContent ? { content: 'O Leon usa a porta 3080.' } : {}),
    redacted: false,
    status: 'active',
    sourceSessionId: sessionId,
    validation: 'explicit',
    createdAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  }
}

function mount(
  items: readonly MemoryCandidateReviewItem[],
  reviewResult: Partial<MemoryCandidateReviewItem> = {},
  memories: readonly MemoryAdminItem[] = [],
  readOnly = false,
) {
  const list = vi.fn(() => Promise.resolve({ items, hasMore: false, nextOffset: items.length }))
  const review = vi.fn((
    _sessionId: SessionId,
    id: MemoryCandidateId,
    decision: 'accept' | 'ignore' | 'reject',
  ) => Promise.resolve(candidate({ id, reviewed: true, reviewDecision: decision, ...reviewResult })))
  const listMemories = vi.fn(() => Promise.resolve({
    items: memories,
    hasMore: false,
    nextOffset: memories.length,
    readOnly,
  }))
  const correctMemory = vi.fn((
    _sessionId: SessionId,
    item: MemoryAdminItem,
    content: string,
  ) => Promise.resolve(memory({ ...item, revision: item.revision + 1, content })))
  const forgetMemory = vi.fn(() => Promise.resolve())
  render(<MemoryReviewButton {...({
    sessionId,
    list,
    review,
    listMemories,
    correctMemory,
    forgetMemory,
    t: makeTranslate(pt),
  } as unknown as MemoryReviewButtonProps)} />)
  return { list, review, listMemories, correctMemory, forgetMemory }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

describe('Leon memory candidate review', () => {
  it('loads only when opened and removes an approved suggestion from the queue', async () => {
    const actions = mount([candidate()])
    expect(actions.list).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    await waitFor(() => { expect(actions.list).toHaveBeenCalledWith(sessionId) })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('O usuário prefere respostas diretas.')).toBeTruthy()
    expect(within(dialog).getByText('Confiança: 94%')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.accept'] }))
    await waitFor(() => {
      expect(actions.review).toHaveBeenCalledWith(sessionId, candidateId('candidate-one'), 'accept')
    })
    expect(within(dialog).getByText(pt['memory.empty'])).toBeTruthy()
    expect(within(dialog).getByRole('status').textContent).toBe(pt['memory.feedback.reviewed'])
    expect(within(dialog).getByText(pt['memory.notice'])).toBeTruthy()
  })

  it('confirms when an approved candidate was stored by the controlled local policy', async () => {
    const actions = mount([candidate()], {
      autoWrite: {
        status: 'stored',
        reason: 'approved-and-authorized',
        recordedAt: '2026-08-25T11:01:00.000Z',
        memoryId: 'memory-one',
        revision: 1,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByText('O usuário prefere respostas diretas.')).toBeTruthy() })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.accept'] }))
    await waitFor(() => { expect(actions.review).toHaveBeenCalledTimes(1) })
    expect(within(dialog).getByRole('status').textContent).toBe(pt['memory.feedback.stored'])
  })

  it('allows rejection but disables approval for blocked or content-free records', async () => {
    const blocked = candidate({
      id: candidateId('blocked'),
      sensitivity: 'blocked',
      policyDecision: 'block',
      policyReason: 'credential-signal',
    }, false)
    const actions = mount([blocked])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByText(pt['memory.noContent'])).toBeTruthy() })
    expect(within(dialog).getByRole('button', { name: pt['memory.accept'] }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.reject'] }))
    await waitFor(() => {
      expect(actions.review).toHaveBeenCalledWith(sessionId, candidateId('blocked'), 'reject')
    })
  })

  it('uses the candidate operation label when no category was classified', async () => {
    mount([candidate({ id: candidateId('operation-only') }, true, false)])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('message_candidate')).toBeTruthy()
  })

  it('shows a retry path when the local queue cannot be loaded', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], hasMore: false, nextOffset: 0 })
    render(<MemoryReviewButton {...({
      sessionId,
      list,
      review: vi.fn(),
      listMemories: vi.fn(),
      correctMemory: vi.fn(),
      forgetMemory: vi.fn(),
      t: makeTranslate(pt),
    } as unknown as MemoryReviewButtonProps)} />)

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    expect((await screen.findByRole('alert')).textContent).toContain(pt['memory.error'])
    fireEvent.click(screen.getByRole('button', { name: pt['memory.retry'] }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(pt['memory.empty'])).toBeTruthy()
  })

  it('lists saved memories and requires a visible confirmation before correction and forgetting', async () => {
    const actions = mount([], {}, [memory()])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await waitFor(() => {
      expect(actions.listMemories).toHaveBeenCalledWith(sessionId, undefined, ['active'])
    })
    expect(within(dialog).getByText('O Leon usa a porta 3080.')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.correct'] }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: pt['memory.saved.editLabel'] }), {
      target: { value: 'O Leon usa a porta 4175.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.reviewCorrection'] }))
    expect(within(dialog).getByText(pt['memory.confirm.correct'])).toBeTruthy()
    expect(actions.correctMemory).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => {
      expect(actions.correctMemory).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ id: 'memory-one', revision: 1 }),
        'O Leon usa a porta 4175.',
      )
    })
    expect(within(dialog).getByText('O Leon usa a porta 4175.')).toBeTruthy()
    expect(within(dialog).getByRole('status').textContent).toBe(pt['memory.feedback.corrected'])

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.forget'] }))
    expect(within(dialog).getByText(pt['memory.confirm.forget'])).toBeTruthy()
    expect(actions.forgetMemory).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.confirm.action'] }))
    await waitFor(() => { expect(actions.forgetMemory).toHaveBeenCalledTimes(1) })
    expect(within(dialog).getByText(pt['memory.saved.empty'])).toBeTruthy()
  })

  it('requests every lifecycle status when the user selects all saved memories', async () => {
    const actions = mount([], {}, [memory()])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await waitFor(() => { expect(actions.listMemories).toHaveBeenCalledTimes(1) })

    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'all' } })
    await waitFor(() => {
      expect(actions.listMemories).toHaveBeenLastCalledWith(
        sessionId,
        undefined,
        ['active', 'scheduled', 'expired', 'superseded'],
      )
    })
  })

  it('filters saved rows, switches tabs without duplicate loading, and exposes retry after failure', async () => {
    const actions = mount([], {}, [memory()])
    actions.listMemories.mockRejectedValueOnce(new Error('offline'))

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(pt['memory.saved.error'])
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.retry'] }))
    await waitFor(() => { expect(actions.listMemories).toHaveBeenCalledTimes(2) })

    fireEvent.change(within(dialog).getByRole('textbox', { name: pt['memory.saved.search'] }), {
      target: { value: '  porta  ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.filter'] }))
    await waitFor(() => {
      expect(actions.listMemories).toHaveBeenLastCalledWith(sessionId, 'porta', ['active'])
    })
    const callsBeforeTabRoundTrip = actions.listMemories.mock.calls.length
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.suggestions'] }))
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    expect(actions.listMemories).toHaveBeenCalledTimes(callsBeforeTabRoundTrip + 1)
  })

  it('shows read-only and redacted saved rows without enabling mutation controls', async () => {
    const actions = mount([], {}, [memory({ redacted: true }, false)], true)

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await waitFor(() => { expect(actions.listMemories).toHaveBeenCalledTimes(1) })
    expect(within(dialog).getByText(pt['memory.saved.readOnly'])).toBeTruthy()
    expect(within(dialog).getByText(pt['memory.saved.redacted'])).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: pt['memory.saved.correct'] }).hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByRole('button', { name: pt['memory.saved.forget'] }).hasAttribute('disabled')).toBe(true)
  })

  it('opens an empty editor for a non-redacted provider row without projected content', async () => {
    const actions = mount([], {}, [memory({ redacted: false }, false)])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await waitFor(() => { expect(actions.listMemories).toHaveBeenCalledTimes(1) })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.correct'] }))
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: pt['memory.saved.editLabel'] }).value).toBe('')
  })

  it('supports cancelling edits and confirmations and disables unchanged corrections', async () => {
    const actions = mount([], {}, [memory()])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await within(dialog).findByText('O Leon usa a porta 3080.')

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.correct'] }))
    const unchanged = within(dialog).getByRole('button', { name: pt['memory.saved.reviewCorrection'] })
    expect(unchanged.hasAttribute('disabled')).toBe(true)
    expect(within(dialog).queryByText(pt['memory.confirm.correct'])).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: pt['memory.saved.editLabel'] }), {
      target: { value: '   ' },
    })
    expect(unchanged.hasAttribute('disabled')).toBe(true)
    expect(within(dialog).queryByText(pt['memory.confirm.correct'])).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.cancel'] }))

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.forget'] }))
    expect(within(dialog).getByText(pt['memory.confirm.forget'])).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.cancel'] }))
    expect(within(dialog).queryByText(pt['memory.confirm.forget'])).toBeNull()
    expect(actions.correctMemory).not.toHaveBeenCalled()
    expect(actions.forgetMemory).not.toHaveBeenCalled()
  })

  it('surfaces review and memory mutation failures through their retry states', async () => {
    const actions = mount([candidate()], {}, [memory()])
    actions.review.mockRejectedValueOnce(new Error('review failed'))

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    let dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('O usuário prefere respostas diretas.')
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.accept'] }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain(pt['memory.error'])
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.retry'] }))
    await within(dialog).findByText('O usuário prefere respostas diretas.')

    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await within(dialog).findByText('O Leon usa a porta 3080.')
    actions.correctMemory.mockRejectedValueOnce(new Error('correction failed'))
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.correct'] }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: pt['memory.saved.editLabel'] }), {
      target: { value: 'O Leon usa a porta 4175.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.reviewCorrection'] }))
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.confirm.action'] }))
    await within(dialog).findByText(pt['memory.saved.error'])
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.retry'] }))
    await within(dialog).findByRole('textbox', { name: pt['memory.saved.editLabel'] })
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.cancel'] }))
    await within(dialog).findByText('O Leon usa a porta 3080.')

    actions.forgetMemory.mockRejectedValueOnce(new Error('forget failed'))
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.saved.forget'] }))
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.confirm.action'] }))
    await within(dialog).findByText(pt['memory.saved.error'])
    dialog = screen.getByRole('dialog')
  })

  it('ignores late candidate and saved-memory results after their view closes', async () => {
    const actions = mount([], {}, [])
    const candidates = deferred<{ items: readonly MemoryCandidateReviewItem[]; hasMore: boolean; nextOffset: number }>()
    actions.list.mockImplementationOnce(() => candidates.promise)

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.close'] }))
    candidates.resolve({ items: [candidate()], hasMore: false, nextOffset: 1 })
    await Promise.resolve()

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    dialog = await screen.findByRole('dialog')
    const saved = deferred<{ items: readonly MemoryAdminItem[]; hasMore: boolean; nextOffset: number; readOnly: boolean }>()
    actions.listMemories.mockImplementationOnce(() => saved.promise)
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.suggestions'] }))
    saved.resolve({ items: [memory()], hasMore: false, nextOffset: 1, readOnly: false })
    await Promise.resolve()

    expect(within(dialog).queryByText('O Leon usa a porta 3080.')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.close'] }))
    const lateCandidateFailure = deferred<{ items: readonly MemoryCandidateReviewItem[]; hasMore: boolean; nextOffset: number }>()
    actions.list.mockImplementationOnce(() => lateCandidateFailure.promise)
    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.close'] }))
    lateCandidateFailure.reject(new Error('late candidate failure'))
    await Promise.resolve()

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    dialog = await screen.findByRole('dialog')
    const lateSavedFailure = deferred<{ items: readonly MemoryAdminItem[]; hasMore: boolean; nextOffset: number; readOnly: boolean }>()
    actions.listMemories.mockImplementationOnce(() => lateSavedFailure.promise)
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.suggestions'] }))
    lateSavedFailure.reject(new Error('late saved failure'))
    await Promise.resolve()
  })

  it('does not replace a newer candidate loading state when a review finishes late', async () => {
    const actions = mount([candidate()])
    const review = deferred<MemoryCandidateReviewItem>()
    actions.review.mockImplementationOnce(() => review.promise)

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    let dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('O usuário prefere respostas diretas.')
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.accept'] }))
    fireEvent.click(within(dialog).getByRole('button', { name: pt['memory.close'] }))
    const reload = deferred<{ items: readonly MemoryCandidateReviewItem[]; hasMore: boolean; nextOffset: number }>()
    actions.list.mockImplementationOnce(() => reload.promise)
    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    dialog = await screen.findByRole('dialog')
    await act(async () => { review.resolve(candidate({ reviewed: true, reviewDecision: 'accept' })) })
    expect(within(dialog).getByText(pt['memory.loading'])).toBeTruthy()
    await act(async () => { reload.resolve({ items: [], hasMore: false, nextOffset: 0 }) })
    expect(await within(dialog).findByText(pt['memory.empty'])).toBeTruthy()
  })

  it('keeps a newer saved-memory load authoritative over late mutation results', async () => {
    const first = memory()
    const second = memory({ id: 'memory-two' as MemoryAdminItem['id'], content: 'Segunda memória.' })
    const actions = mount([], {}, [first, second])

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: pt['memory.tabs.saved'] }))
    await within(dialog).findByText('Segunda memória.')

    const firstCard = dialog.querySelector('[data-memory-record="memory-one:1"]')
    if (!(firstCard instanceof HTMLElement)) throw new Error('first memory card missing in test')
    fireEvent.click(within(firstCard).getByRole('button', { name: pt['memory.saved.correct'] }))
    fireEvent.change(within(firstCard).getByRole('textbox', { name: pt['memory.saved.editLabel'] }), {
      target: { value: 'Primeira memória corrigida.' },
    })
    fireEvent.click(within(firstCard).getByRole('button', { name: pt['memory.saved.reviewCorrection'] }))
    fireEvent.click(within(firstCard).getByRole('button', { name: pt['memory.confirm.action'] }))
    await within(dialog).findByText('Primeira memória corrigida.')
    expect(within(dialog).getByText('Segunda memória.')).toBeTruthy()

    const correction = deferred<MemoryAdminItem>()
    actions.correctMemory.mockImplementationOnce(() => correction.promise)
    const correctedCard = dialog.querySelector('[data-memory-record="memory-one:2"]')
    if (!(correctedCard instanceof HTMLElement)) throw new Error('corrected memory card missing in test')
    fireEvent.click(within(correctedCard).getByRole('button', { name: pt['memory.saved.correct'] }))
    fireEvent.change(within(correctedCard).getByRole('textbox', { name: pt['memory.saved.editLabel'] }), {
      target: { value: 'Correção tardia.' },
    })
    fireEvent.click(within(correctedCard).getByRole('button', { name: pt['memory.saved.reviewCorrection'] }))
    fireEvent.click(within(correctedCard).getByRole('button', { name: pt['memory.confirm.action'] }))
    const correctionReload = deferred<{ items: readonly MemoryAdminItem[]; hasMore: boolean; nextOffset: number; readOnly: boolean }>()
    actions.listMemories.mockImplementationOnce(() => correctionReload.promise)
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'scheduled' } })
    await act(async () => { correction.resolve(memory({ revision: 3, content: 'Correção tardia.' })) })
    await waitFor(() => { expect(actions.listMemories).toHaveBeenLastCalledWith(sessionId, undefined, ['scheduled']) })
    await act(async () => {
      correctionReload.resolve({ items: [first, second], hasMore: false, nextOffset: 2, readOnly: false })
    })

    const forgetting = deferred<undefined>()
    actions.forgetMemory.mockImplementationOnce(() => forgetting.promise)
    await within(dialog).findByText('O Leon usa a porta 3080.')
    const reloadedCard = dialog.querySelector('[data-memory-record="memory-one:1"]')
    if (!(reloadedCard instanceof HTMLElement)) throw new Error('reloaded memory card missing in test')
    fireEvent.click(within(reloadedCard).getByRole('button', { name: pt['memory.saved.forget'] }))
    fireEvent.click(within(reloadedCard).getByRole('button', { name: pt['memory.confirm.action'] }))
    const forgetReload = deferred<{ items: readonly MemoryAdminItem[]; hasMore: boolean; nextOffset: number; readOnly: boolean }>()
    actions.listMemories.mockImplementationOnce(() => forgetReload.promise)
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'expired' } })
    await act(async () => { forgetting.resolve(undefined) })
    await waitFor(() => { expect(actions.listMemories).toHaveBeenLastCalledWith(sessionId, undefined, ['expired']) })
    await act(async () => {
      forgetReload.resolve({ items: [first, second], hasMore: false, nextOffset: 2, readOnly: false })
    })
  })
})
