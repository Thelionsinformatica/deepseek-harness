// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { ArchivedSessionsDialog } from '../src/client/ArchivedSessionsDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as WorkspaceBrowserProps['t']
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides,
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
})
const workspace = (sessionIds: readonly SessionId[]): WorkspaceView => ({
  workspaceId: wid('project'),
  path: '/projects/project',
  title: 'Project',
  sessionIds: [...sessionIds],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(overrides: Partial<{
  sessions: SessionListState
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionId[]
  unarchiveSession: WorkspaceBrowserProps['unarchiveSession']
  deleteSession: WorkspaceBrowserProps['deleteSession']
  onClose: () => void
}> = {}) {
  const sessions = overrides.sessions ?? sessionState([])
  const props = {
    useSessions: hook(sessions) as WorkspaceBrowserProps['useSessions'],
    workspaces: overrides.workspaces ?? [],
    archivedSessionIds: overrides.archivedSessionIds ?? [],
    unarchiveSession: overrides.unarchiveSession ?? vi.fn(async () => {}),
    deleteSession: overrides.deleteSession ?? vi.fn(async () => {}),
    onClose: overrides.onClose ?? vi.fn(),
    t,
  }
  return { view: render(<ArchivedSessionsDialog {...props} />), props }
}

describe('ArchivedSessionsDialog', () => {
  it('keeps the discoverable surface useful when the archive is empty', () => {
    const onClose = vi.fn()
    mount({ onClose })
    expect(screen.getByRole('dialog', { name: '已归档会话' })).toBeTruthy()
    expect(screen.getByText('暂无已归档会话')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders titled, blank, and unavailable archived rows with their Workspace context', () => {
    const normal = summary('normal', 3, { displayTitle: 'Normal chat' })
    const blank = summary('blank', 2, { blank: true })
    mount({
      sessions: sessionState([blank, normal]),
      workspaces: [workspace([normal.id, blank.id])],
      archivedSessionIds: [sid('missing'), blank.id, normal.id],
    })
    expect(screen.getByText('Normal chat')).toBeTruthy()
    expect(screen.getByText('新会话')).toBeTruthy()
    expect(screen.getByText('会话不可用')).toBeTruthy()
    expect(screen.getAllByText('Project')).toHaveLength(2)
    expect(screen.getByText('未分组')).toBeTruthy()
  })

  it('keeps the archived row and dialog open when restore is rejected', async () => {
    const item = summary('restore-me', 1, { displayTitle: 'Restore me' })
    const unarchiveSession = vi.fn(async () => { throw new Error('restore denied') })
    mount({
      sessions: sessionState([item]),
      archivedSessionIds: [item.id],
      unarchiveSession,
    })
    fireEvent.click(screen.getByRole('button', { name: '恢复“Restore me”' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('restore denied') })
    expect(screen.getByRole('dialog', { name: '已归档会话' })).toBeTruthy()
    expect(screen.getByText('Restore me')).toBeTruthy()
    expect(unarchiveSession).toHaveBeenCalledWith(item.id)
  })

  it('does not close a pending delete and returns to the preserved item after rejection', async () => {
    const item = summary('delete-me', 1, { displayTitle: 'Delete me' })
    let rejectDelete!: (reason: unknown) => void
    const deleteSession = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectDelete = reject }))
    mount({
      sessions: sessionState([item]),
      archivedSessionIds: [item.id],
      deleteSession,
    })
    fireEvent.click(screen.getByRole('button', { name: '永久删除“Delete me”' }))
    const confirmation = screen.getByRole('dialog', { name: '删除会话' })
    expect(confirmation.textContent).toContain('不会删除其工作区中的文件')
    expect(confirmation.textContent).toContain('个人记忆')
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    expect(screen.getByText('正在删除会话…')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeTruthy()

    rejectDelete('delete denied')
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('delete denied') })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('dialog', { name: '已归档会话' })).toBeTruthy()
    expect(screen.getByText('Delete me')).toBeTruthy()
    expect(deleteSession).toHaveBeenCalledWith(item.id)
  })

  it('settles successful restore and permanent deletion without closing early', async () => {
    const restoreItem = summary('restore', 2, { displayTitle: 'Restore success' })
    const deleteItem = summary('delete', 1, { displayTitle: 'Delete success' })
    let resolveRestore!: () => void
    const unarchiveSession = vi.fn(() => new Promise<void>((resolve) => { resolveRestore = resolve }))
    const deleteSession = vi.fn(async () => {})
    mount({
      sessions: sessionState([restoreItem, deleteItem]),
      archivedSessionIds: [restoreItem.id, deleteItem.id],
      unarchiveSession,
      deleteSession,
    })

    fireEvent.click(screen.getByRole('button', { name: '恢复“Restore success”' }))
    expect(screen.getByRole('button', { name: '恢复“Restore success”' }).textContent)
      .toContain('正在恢复会话…')
    resolveRestore()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '恢复“Restore success”' }).textContent).toContain('恢复')
    })

    fireEvent.click(screen.getByRole('button', { name: '永久删除“Delete success”' }))
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '已归档会话' })).toBeTruthy()
    })
    expect(deleteSession).toHaveBeenCalledWith(deleteItem.id)
  })
})
