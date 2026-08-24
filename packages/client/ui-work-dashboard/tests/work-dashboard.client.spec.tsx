// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkDashboard, type WorkDashboardProps } from '../src/client/WorkDashboard.tsx'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function workspace(id: string, title: string, sessionIds: SessionId[] = []): WorkspaceView {
  return {
    workspaceId: wid(id), path: `E:/computador/${id}`, title, sessionIds,
    createdAt: '2026-08-22T10:00:00.000Z', updatedAt: '2026-08-22T11:00:00.000Z',
  }
}

function session(id: string, displayTitle: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id), displayTitle, running: false, blank: false, updatedAt: 1,
    ...overrides,
  }
}

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(options: {
  sessions?: SessionSummary[]
  workspaces?: WorkspaceView[]
  archived?: SessionId[]
} = {}) {
  const rows = options.sessions ?? []
  const sessionState: SessionListState = {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const items = options.workspaces ?? []
  const workspaceState: WorkspaceListState = {
    items,
    archivedSessionIds: options.archived ?? [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: items[0]?.workspaceId,
  }
  const startSession = vi.fn()
  const openSession = vi.fn()
  const props: WorkDashboardProps = {
    useSessions: hook(sessionState),
    useWorkspaces: hook(workspaceState),
    startSession,
    openSession,
    t: makeTranslate(pt),
  }
  return { view: render(<WorkDashboard {...props} />), startSession, openSession }
}

function metric(label: string): HTMLElement {
  return screen.getAllByText(label)
    .map(element => element.closest('article'))
    .find((element): element is HTMLElement => element !== null)!
}

describe('Leon Work dashboard', () => {
  it('projects live metrics and recent work without archived, blank, or subagent rows', () => {
    const running = session('running', 'Implantar memória', { running: true, updatedAt: 40 })
    const waiting = session('waiting', 'Revisar automação', {
      pendingInteraction: 'question', updatedAt: 30,
    })
    const completed = session('completed', 'Preparar instalador', { completed: true, updatedAt: 20 })
    const ready = session('ready', 'Organizar documentos', {
      updatedAt: 10,
      projectionValues: {
        sessionStats: {
          turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
          decodeMs: 0, decodeTokens: 0, estimatedApiCostUsdNanos: 1_140_000,
          pricedModelCalls: 1, unpricedModelCalls: 0,
        },
      },
    })
    const archived = session('archived', 'Tarefa arquivada', { running: true, updatedAt: 50 })
    const blank = session('blank', 'Nova sessão', { blank: true, updatedAt: 60 })
    const child = session('child', 'Subagente interno', { origin: 'subagent', running: true, updatedAt: 70 })
    mount({
      sessions: [running, waiting, completed, ready, archived, blank, child],
      workspaces: [
        workspace('leon', 'Leon', [running.id, waiting.id, completed.id]),
        workspace('docs', 'Documentos', [ready.id]),
      ],
      archived: [archived.id],
    })

    expect(screen.getByRole('region', { name: 'Painel Leon Work' })).toBeTruthy()
    expect(metric('Projetos').textContent).toContain('2')
    expect(metric('Em andamento').textContent).toContain('1')
    expect(metric('Aguardando você').textContent).toContain('1')
    expect(metric('Concluídas').textContent).toContain('1')
    expect(metric('API acumulada').textContent).toContain('US$0.0011')
    expect(metric('API acumulada').textContent).toContain('1 chamadas com preço')

    const recent = within(screen.getByRole('heading', { name: 'Trabalhos recentes' }).parentElement!)
    expect(recent.getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('Implantar memória'),
      expect.stringContaining('Revisar automação'),
      expect.stringContaining('Preparar instalador'),
    ])
    expect(screen.queryByText('Tarefa arquivada')).toBeNull()
    expect(screen.queryByText('Nova sessão')).toBeNull()
    expect(screen.queryByText('Subagente interno')).toBeNull()
  })

  it('starts a task and opens one recent session through the owning runtimes', () => {
    const row = session('recent', 'Continuar Leon', { updatedAt: 9 })
    const b = mount({ sessions: [row], workspaces: [workspace('leon', 'Leon')] })

    expect(screen.getByText('Sem projeto')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar Continuar Leon' }))

    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.openSession).toHaveBeenCalledWith(row.id)
  })

  it('shows a truthful empty state when no work exists yet', () => {
    mount()
    expect(screen.getByText('Suas conversas aparecerão aqui depois da primeira tarefa.')).toBeTruthy()
    expect(metric('Projetos').textContent).toContain('0')
    expect(metric('API acumulada').textContent).toContain('US$0.00')
  })

  it('warns when a model usage route has no configured price', () => {
    const unpriced = session('unpriced', 'Modelo futuro', {
      projectionValues: {
        sessionStats: {
          turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
          decodeMs: 0, decodeTokens: 0, estimatedApiCostUsdNanos: 0,
          pricedModelCalls: 0, unpricedModelCalls: 2,
        },
      },
    })
    mount({ sessions: [unpriced] })
    expect(metric('API acumulada').textContent).toContain('2 chamadas ainda sem preço')
  })

  it('keeps archived and subagent calls in billing while hiding their navigation rows', () => {
    const cost = {
      turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
      decodeMs: 0, decodeTokens: 0, estimatedApiCostUsdNanos: 1_000_000_000,
      pricedModelCalls: 1, unpricedModelCalls: 0,
    }
    const archived = session('archived-cost', 'Arquivada com custo', {
      projectionValues: { sessionStats: cost },
    })
    const child = session('child-cost', 'Subagente com custo', {
      origin: 'subagent', projectionValues: { sessionStats: cost },
    })
    mount({ sessions: [archived, child], archived: [archived.id] })

    expect(metric('API acumulada').textContent).toContain('US$2.00')
    expect(screen.queryByText('Arquivada com custo')).toBeNull()
    expect(screen.queryByText('Subagente com custo')).toBeNull()
  })
})
