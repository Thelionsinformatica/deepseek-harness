// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryCandidateId, MemoryCandidateReviewItem } from '@deepseek-ai/dsh-tool-memory/types'
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
): MemoryCandidateReviewItem {
  return {
    id: candidateId('candidate-one'),
    sessionId,
    operation: 'message_candidate',
    ...(includeContent ? { candidateContent: 'O usuário prefere respostas diretas.' } : {}),
    category: 'preference',
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

function mount(
  items: readonly MemoryCandidateReviewItem[],
  reviewResult: Partial<MemoryCandidateReviewItem> = {},
) {
  const list = vi.fn(() => Promise.resolve({ items, hasMore: false, nextOffset: items.length }))
  const review = vi.fn((
    _sessionId: SessionId,
    id: MemoryCandidateId,
    decision: 'accept' | 'ignore' | 'reject',
  ) => Promise.resolve(candidate({ id, reviewed: true, reviewDecision: decision, ...reviewResult })))
  render(<MemoryReviewButton {...({
    sessionId,
    list,
    review,
    t: makeTranslate(pt),
  } as unknown as MemoryReviewButtonProps)} />)
  return { list, review }
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

  it('shows a retry path when the local queue cannot be loaded', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], hasMore: false, nextOffset: 0 })
    render(<MemoryReviewButton {...({
      sessionId,
      list,
      review: vi.fn(),
      t: makeTranslate(pt),
    } as unknown as MemoryReviewButtonProps)} />)

    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    expect((await screen.findByRole('alert')).textContent).toContain(pt['memory.error'])
    fireEvent.click(screen.getByRole('button', { name: pt['memory.retry'] }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(pt['memory.empty'])).toBeTruthy()
  })
})
