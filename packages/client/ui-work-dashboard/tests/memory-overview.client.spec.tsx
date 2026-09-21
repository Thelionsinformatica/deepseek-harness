// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryAdminItem } from '@deepseek-ai/dsh-tool-memory/types'
import { MemoryOverviewPanel, type MemoryOverviewProps } from '../src/client/MemoryOverviewPanel.tsx'
import { MemoryReviewButton, type MemoryReviewButtonProps } from '../src/client/MemoryReviewButton.tsx'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)
const sessionId = 'overview-session' as SessionId

function memory(id: string, content: string, overrides: Partial<MemoryAdminItem> = {}): MemoryAdminItem {
  return {
    id: id as MemoryAdminItem['id'], content, revision: 2, redacted: false, status: 'active',
    sourceSessionId: sessionId, createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}

function fixture() {
  const listMemories = vi.fn<MemoryOverviewProps['listMemories']>(async () => ({
    items: [memory('project-one', 'Workspace usa testes locais.')], readOnly: false, hasMore: false, nextOffset: 1,
  }))
  const listPersonalMemories = vi.fn<MemoryOverviewProps['listPersonalMemories']>(async () => ({
    items: [memory('personal-one', 'Prefiro português.')], enabled: true, readOnly: false, hasMore: false, nextOffset: 1,
  }))
  const listCapabilities = vi.fn<MemoryOverviewProps['listCapabilities']>(async () => ({
    agentPreset: 'leon', complete: true, modelToolAvailable: true, authorization: 'not-evaluated', observedAt: '2026-09-21T13:00:00.000Z',
    skills: [{ name: 'leon-browser', description: 'Navegação autorizada.', source: 'preset/skills/leon-browser', modelInvocable: true, userInvocable: true }],
  }))
  const memoryGraph = vi.fn<MemoryOverviewProps['memoryGraph']>(async () => ({
    status: 'pending' as const, generation: 0, edges: [],
  }))
  const personalMemoryGraph = vi.fn<MemoryOverviewProps['personalMemoryGraph']>(async () => ({
    status: 'pending' as const, generation: 0, edges: [],
  }))
  const state = { byId: { [sessionId]: { agentPreset: 'leon' } } } as SessionListState
  const props: MemoryOverviewProps = {
    sessionId, listMemories, listPersonalMemories, listCapabilities, memoryGraph, personalMemoryGraph,
    useSessions: selector => selector(state), t: makeTranslate(pt),
  }
  return { props, state, listMemories, listPersonalMemories, listCapabilities, memoryGraph, personalMemoryGraph }
}

describe('memory and capability overview', () => {
  it('loads only after its tab opens and never submits a memory mutation', async () => {
    const b = fixture()
    const list = vi.fn(async () => ({ items: [], hasMore: false, nextOffset: 0 }))
    const review = vi.fn()
    render(<MemoryReviewButton {...{ ...b.props, list, review } as unknown as MemoryReviewButtonProps} />)
    expect(b.listPersonalMemories).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.open'] }))
    await screen.findByText(pt['memory.empty'])
    expect(b.listCapabilities).not.toHaveBeenCalled()
    expect(b.listPersonalMemories).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: pt['memory.tabs.overview'] }))
    await screen.findByRole('button', { name: /leon-browser/ })
    expect(b.listMemories).toHaveBeenCalledWith(sessionId, undefined, ['active', 'scheduled', 'expired', 'superseded'])
    expect(b.listPersonalMemories).toHaveBeenCalledWith(sessionId)
    expect(review).not.toHaveBeenCalled()
  })

  it('draws derived similarity edges only between published memory pairs', async () => {
    const b = fixture()
    b.listMemories.mockResolvedValue({
      items: [memory('project-one', 'Workspace usa testes locais.'), memory('project-two', 'Workspace roda testes locais.')],
      readOnly: false, hasMore: false, nextOffset: 2,
    })
    b.memoryGraph.mockResolvedValue({
      status: 'computed', generation: 3,
      edges: [{ a: 'project-one' as MemoryAdminItem['id'], b: 'project-two' as MemoryAdminItem['id'], score: 0.9 }],
    })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await waitFor(() => {
      expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(1)
    })
    expect(b.memoryGraph).toHaveBeenCalledWith(sessionId)
    expect(b.personalMemoryGraph).toHaveBeenCalledWith(sessionId)
  })

  it('projects actual groups, source details and dates without claiming operational verification', async () => {
    const b = fixture()
    render(<MemoryOverviewPanel {...b.props} />)
    fireEvent.click(await screen.findByRole('button', { name: /leon-browser/ }))
    expect(screen.getByText(pt['memory.overview.available'])).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.authorization'])).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.authorizationNotEvaluated'])).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.noTest'])).toBeTruthy()
    expect(screen.getByText('preset/skills/leon-browser')).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.graphNotice'])).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.changesNotice'])).toBeTruthy()
    const project = screen.getByRole('region', { name: pt['memory.overview.group.workspace'] })
    fireEvent.click(within(project).getByRole('button', { name: /Workspace usa testes locais/ }))
    const details = screen.getByRole('complementary', { name: pt['memory.overview.details'] })
    expect(within(details).getByText('project-one')).toBeTruthy()
    expect(within(details).getByText('2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.refresh'] }))
    await waitFor(() => { expect(b.listCapabilities).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText('project-one')).toBeNull()
  })

  it('reports source failure and pagination without suppressing the other sources', async () => {
    const b = fixture()
    b.listMemories.mockRejectedValue(new Error('private-path-error-not-exposed'))
    b.listPersonalMemories.mockResolvedValue({ items: [], enabled: false, readOnly: false, hasMore: true, nextOffset: 100 })
    render(<MemoryOverviewPanel {...b.props} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Projeto')
    expect(screen.queryByText(/private-path-error/)).toBeNull()
    expect(screen.getByText(pt['memory.overview.partial'])).toBeTruthy()
    expect(screen.getByText(pt['memory.personal.disabledDetail'])).toBeTruthy()
    expect(screen.getByRole('button', { name: /leon-browser/ })).toBeTruthy()
  })

  it('does not expose redacted content in graph, list, details or change dates', async () => {
    const b = fixture()
    b.listMemories.mockResolvedValue({ items: [memory('redacted-one', 'protected-value', { redacted: true })], readOnly: true, hasMore: false, nextOffset: 1 })
    render(<MemoryOverviewPanel {...b.props} />)
    const project = screen.getByRole('region', { name: pt['memory.overview.group.workspace'] })
    fireEvent.click(await within(project).findByRole('button', { name: /Conteúdo protegido/ }))
    expect(screen.queryByText('protected-value')).toBeNull()
    expect(screen.getByText('redacted-one')).toBeTruthy()
  })

  it('keeps project records inspectable when personal memory and skill inspection fail', async () => {
    const b = fixture()
    b.listPersonalMemories.mockRejectedValue(new Error('personal denied'))
    b.listCapabilities.mockRejectedValue(new Error('skill denied'))
    render(<MemoryOverviewPanel {...b.props} />)
    await waitFor(() => { expect(screen.getAllByRole('alert')).toHaveLength(2) })
    expect(screen.getByText(pt['memory.overview.partial'])).toBeTruthy()
    expect(screen.getByRole('region', { name: pt['memory.overview.group.workspace'] }).textContent).toContain('Workspace usa testes locais.')
    expect(screen.queryByText(pt['memory.overview.available'])).toBeNull()
  })

  it.each([
    { complete: false, modelToolAvailable: true, modelInvocable: true, expected: 'memory.overview.unconfirmed' },
    { complete: true, modelToolAvailable: false, modelInvocable: true, expected: 'memory.overview.notAvailable' },
    { complete: true, modelToolAvailable: true, modelInvocable: false, expected: 'memory.overview.notAvailable' },
  ] as const)('distinguishes registered skills from availability: %s', async ({ complete, modelToolAvailable, modelInvocable, expected }) => {
    const b = fixture()
    b.listCapabilities.mockResolvedValue({
      agentPreset: null, complete, modelToolAvailable, authorization: 'not-evaluated', observedAt: '2026-09-21T13:00:00.000Z',
      skills: [{ name: 'private-skill', description: '', source: 'private', modelInvocable, userInvocable: false }],
    })
    render(<MemoryOverviewPanel {...b.props} />)
    fireEvent.click(await screen.findByRole('button', { name: /private-skill/ }))
    expect(screen.getByText(pt[expected])).toBeTruthy()
    expect(screen.getByText(pt['memory.overview.authorizationNotEvaluated'])).toBeTruthy()
    expect(screen.queryByText(pt['memory.overview.available'])).toBeNull()
  })

  it('invalidates observations and ignores a late response after the session preset changes', async () => {
    const b = fixture()
    let resolve!: (value: Awaited<ReturnType<MemoryOverviewProps['listCapabilities']>>) => void
    b.listCapabilities.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await waitFor(() => { expect(b.listCapabilities).toHaveBeenCalledTimes(1) })
    b.state.byId[sessionId]!.agentPreset = 'cordis'
    b.listCapabilities.mockResolvedValue({ agentPreset: 'cordis', complete: true, modelToolAvailable: false, authorization: 'not-evaluated', skills: [], observedAt: '2026-09-21T14:00:00.000Z' })
    view.rerender(<MemoryOverviewPanel {...b.props} />)
    await screen.findByText(/Perfil da conversa: cordis/)
    await act(async () => { resolve({ agentPreset: 'old-preset', complete: true, modelToolAvailable: true, authorization: 'not-evaluated', skills: [], observedAt: '2026-09-21T13:00:00.000Z' }) })
    expect(screen.queryByText(/old-preset/)).toBeNull()
  })
})
