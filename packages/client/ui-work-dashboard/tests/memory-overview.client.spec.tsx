// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryAdminGraphValue, MemoryAdminItem } from '@deepseek-ai/dsh-tool-memory/types'
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

function graphPair(prefix = 'project'): MemoryAdminGraphValue['edges'] {
  return [{
    a: `${prefix}-one` as MemoryAdminItem['id'], aRevision: 2,
    b: `${prefix}-two` as MemoryAdminItem['id'], bRevision: 2, score: 0.9,
  }]
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
  it('shows the observed preset and counts active records with partial and unknown sources', async () => {
    const b = fixture()
    b.listMemories.mockResolvedValue({
      items: [memory('one', 'Active'), memory('two', 'Expired', { status: 'expired' })],
      readOnly: false, hasMore: true, nextOffset: 2,
    })
    b.listPersonalMemories.mockRejectedValue(new Error('private source error'))
    render(<MemoryOverviewPanel {...b.props} />)
    const profile = screen.getByRole('complementary', { name: pt['memory.overview.agentProfile'] })
    expect(within(profile).getAllByText('—')).toHaveLength(3)
    await within(profile).findByRole('heading', { name: 'leon' })
    expect(within(profile).getByText('1+')).toBeTruthy()
    expect(within(profile).getByText('1', { selector: 'dd' })).toBeTruthy()
    expect(within(profile).getByText('—')).toBeTruthy()
    expect(within(profile).getByText(pt['memory.overview.countsNotice'])).toBeTruthy()
  })

  it('selects actual graph nodes with keyboard and zooms without fetching or drawing synthetic links', async () => {
    const b = fixture()
    const view = render(<MemoryOverviewPanel {...b.props} />)
    const node = await screen.findByRole('button', { name: 'Inspecionar nó 1 de Projeto' })
    fireEvent.keyDown(node, { key: 'Enter' })
    expect(node.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('complementary', { name: pt['memory.overview.details'] }).textContent).toContain('project-one')
    expect(view.container.querySelectorAll('line')).toHaveLength(0)
    const graph = screen.getByRole('group', { name: pt['memory.overview.graph'] })
    const originalView = graph.getAttribute('viewBox')
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.zoomIn'] }))
    expect(graph.getAttribute('viewBox')).not.toBe(originalView)
    expect(screen.getByRole('button', { name: pt['memory.overview.zoomReset'] }).textContent).toBe('125%')
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.zoomReset'] }))
    expect(graph.getAttribute('viewBox')).toBe(originalView)
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.zoomOut'] }))
    expect(screen.getByRole('button', { name: pt['memory.overview.zoomOut'] }).hasAttribute('disabled')).toBe(true)
    expect(b.listCapabilities).toHaveBeenCalledTimes(1)
    expect(b.listMemories).toHaveBeenCalledTimes(1)
  })

  it('switches to records and back while retaining the selected details', async () => {
    const b = fixture()
    render(<MemoryOverviewPanel {...b.props} />)
    fireEvent.click(await screen.findByRole('button', { name: /leon-browser/ }))
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.recordsView'], exact: true }))
    expect(screen.queryByRole('group', { name: pt['memory.overview.graph'] })).toBeNull()
    expect(screen.getByRole('region', { name: pt['memory.overview.group.skills'] })).toBeTruthy()
    expect(screen.getByText('preset/skills/leon-browser')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.graphView'], exact: true }))
    expect(screen.getByRole('button', { name: 'Inspecionar nó 1 de Habilidades' }).getAttribute('aria-pressed')).toBe('true')
    expect(b.listCapabilities).toHaveBeenCalledTimes(1)
  })

  it('derives calendar marks from the latest returned update month and keeps the audit limitation visible', async () => {
    const b = fixture()
    b.listMemories.mockResolvedValue({ items: [
      memory('old', 'Old record', { updatedAt: '2026-08-10T12:00:00.000Z' }),
      memory('recent', 'Recent record', { updatedAt: '2026-09-03T12:00:00.000Z' }),
    ], readOnly: false, hasMore: false, nextOffset: 2 })
    render(<MemoryOverviewPanel {...b.props} />)
    const calendar = await screen.findByRole('region', { name: pt['memory.overview.calendar'] })
    expect(within(calendar).getAllByTitle(pt['memory.overview.updated']).map(day => day.textContent)).toEqual(['3', '21'])
    expect(screen.getByText(pt['memory.overview.changesNotice'])).toBeTruthy()
    const details = screen.getByRole('complementary', { name: pt['memory.overview.details'] })
    fireEvent.click(within(details).getByRole('button', { name: /Recent record/ }))
    expect(within(details).getByText('recent', { selector: 'h4' })).toBeTruthy()
  })

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
      edges: graphPair(),
    })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await waitFor(() => {
      expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(1)
    })
    expect(b.memoryGraph).toHaveBeenCalledWith(sessionId)
    expect(b.personalMemoryGraph).toHaveBeenCalledWith(sessionId)
  })

  it.each((['workspace', 'personal'] as const).flatMap(group => (
    ['pending', 'failed', 'stale', 'computed', 'empty', 'unavailable'] as const
  ).map(status => ({ group, status }))))('announces $group graph state $status and only draws computed edges', async ({ group, status }) => {
    const b = fixture()
    b.listMemories.mockResolvedValue({
      items: [memory('project-one', 'First project record'), memory('project-two', 'Second project record')],
      readOnly: false, hasMore: false, nextOffset: 2,
    })
    b.listPersonalMemories.mockResolvedValue({
      items: [memory('personal-one', 'First personal record'), memory('personal-two', 'Second personal record')],
      enabled: true, readOnly: false, hasMore: false, nextOffset: 2,
    })
    const graph = group === 'workspace' ? b.memoryGraph : b.personalMemoryGraph
    graph.mockResolvedValue({ status, generation: 3, edges: graphPair(group === 'workspace' ? 'project' : 'personal') })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    const label = b.props.t('memory.overview.graphStatus', { value: pt[`memory.overview.group.${group}`] })
    const state = await screen.findByRole(status === 'failed' ? 'alert' : 'status', { name: label })
    await waitFor(() => { expect(state.textContent).toContain(pt[`memory.overview.graphState.${status}`]) })
    expect(state.getAttribute('aria-atomic')).toBe('true')
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(status === 'computed' ? 1 : 0)
  })

  it.each(['aRevision', 'bRevision'] as const)('does not attach an edge to a newer node with the same id when %s differs', async (revision) => {
    const b = fixture()
    b.listMemories.mockResolvedValue({
      items: [memory('project-one', 'New first record'), memory('project-two', 'New second record')],
      readOnly: false, hasMore: false, nextOffset: 2,
    })
    b.memoryGraph.mockResolvedValue({
      status: 'computed', generation: 4,
      edges: graphPair().map(edge => ({ ...edge, [revision]: 1 })),
    })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await screen.findByText(pt['memory.overview.graphState.computed'])
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(0)
    expect(screen.getByRole('region', { name: pt['memory.overview.group.workspace'] }).textContent).toContain('New first record')
  })

  it('removes previously drawn edges while refreshing and after a stale or failed result', async () => {
    const b = fixture()
    b.listMemories.mockResolvedValue({
      items: [memory('project-one', 'First record'), memory('project-two', 'Second record')],
      readOnly: false, hasMore: false, nextOffset: 2,
    })
    b.memoryGraph.mockResolvedValue({ status: 'computed', generation: 3, edges: graphPair() })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await waitFor(() => { expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(1) })
    let settle!: (value: MemoryAdminGraphValue) => void
    b.memoryGraph.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.refresh'] }))
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(0)
    expect(screen.getByRole('region', { name: pt['memory.overview.aria'] }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { settle({ status: 'stale', generation: 4, edges: graphPair() }) })
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(0)
    expect(screen.getByText(pt['memory.overview.graphState.stale'])).toBeTruthy()
    b.memoryGraph.mockResolvedValue({ status: 'failed', generation: 4, edges: graphPair(), failureCode: 'TIMEOUT' })
    fireEvent.click(screen.getByRole('button', { name: pt['memory.overview.refresh'] }))
    await screen.findByText(pt['memory.overview.graphState.failed'])
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(0)
  })

  it.each([
    'computation-failed', 'graph-limit-exceeded', 'INPUT_TOO_LARGE', 'TIMEOUT',
    'TRANSPORT', 'HTTP_ERROR', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE',
  ])('shows the public failure code %s without hiding other sources', async (failureCode) => {
    const b = fixture()
    b.memoryGraph.mockResolvedValue({ status: 'failed', generation: 3, edges: [], failureCode })
    render(<MemoryOverviewPanel {...b.props} />)
    const alert = await screen.findByRole('alert', { name: 'Grafo: Projeto' })
    expect(alert.textContent).toContain(b.props.t('memory.overview.graphFailureCode', { value: failureCode }))
    expect(screen.getByRole('button', { name: /leon-browser/ })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Grafo: Pessoal' }).textContent).toContain(pt['memory.overview.graphState.pending'])
  })

  it.each(['private-path-error', 'C:\\private\\owner.txt', 'sk-private-token', '<script>private</script>', 'TIMEOUT\nprivate detail'])('never displays an arbitrary failure value: %s', async (failureCode) => {
    const b = fixture()
    b.personalMemoryGraph.mockResolvedValue({ status: 'failed', generation: 3, edges: [], failureCode })
    const view = render(<MemoryOverviewPanel {...b.props} />)
    const alert = await screen.findByRole('alert', { name: 'Grafo: Pessoal' })
    expect(alert.textContent).toContain(pt['memory.overview.graphState.failed'])
    expect(view.container.textContent).not.toContain(failureCode)
    expect(view.container.textContent).not.toContain('Código da falha:')
  })

  it('announces graph request failures independently without exposing raw exceptions', async () => {
    const b = fixture()
    b.memoryGraph.mockRejectedValue(new Error('private-workspace-error'))
    b.personalMemoryGraph.mockRejectedValue(new Error('private-personal-error'))
    const view = render(<MemoryOverviewPanel {...b.props} />)
    await screen.findByRole('alert', { name: 'Grafo: Projeto' })
    await screen.findByRole('alert', { name: 'Grafo: Pessoal' })
    expect(screen.getAllByText(pt['memory.overview.graphState.error'])).toHaveLength(2)
    expect(view.container.textContent).not.toContain('private-')
    expect(view.container.querySelectorAll('line[stroke-width]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /leon-browser/ })).toBeTruthy()
    expect(screen.getByRole('region', { name: pt['memory.overview.aria'] }).getAttribute('aria-busy')).toBe('false')
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
    expect(within(details).getByText('2', { selector: 'dd' })).toBeTruthy()
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
