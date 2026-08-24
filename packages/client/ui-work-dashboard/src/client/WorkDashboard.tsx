/** Leon Work blank-session dashboard over live Session and Workspace projections. */
import {
  IconChevronRightOutline14, IconFolderOpenOutline16, IconNewChatOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SessionId, SessionSummary, WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: adds the optional sessionStats key to the shared projection map.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import css from './WorkDashboard.module.css'

/** Business actions supplied by the dashboard registration. */
export interface WorkDashboardInjected {
  /** Start or reuse a blank Session, optionally inside one Workspace. */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Open one existing Session from the recent-work list. */
  openSession: (sessionId: SessionId) => void
}

/** Full dashboard props from the Hero slot, locale seat, and injected actions. */
export type WorkDashboardProps =
  PropsRuntime<'conversation.hero.dashboard'>
  & PropsLocale<'work-dashboard'>
  & WorkDashboardInjected

/** Resolve the status presented by one recent Session. */
function statusOf(session: SessionSummary): 'waiting' | 'running' | 'completed' | 'ready' {
  if (session.pendingInteraction !== undefined) return 'waiting'
  if (session.running) return 'running'
  if (session.completed === true) return 'completed'
  return 'ready'
}

/** Render one live metric card. */
function Metric({ value, label, detail, tone }: {
  value: number | string
  label: string
  detail: string
  tone: 'neutral' | 'active' | 'warning' | 'success'
}) {
  return (
    <article className={css.metric} data-tone={tone}>
      <span className={css.metricLabel}>{label}</span>
      <strong className={css.metricValue}>{value}</strong>
      <span className={css.metricDetail}>{detail}</span>
    </article>
  )
}

interface ApiCostSnapshot {
  estimatedApiCostUsdNanos: number
  pricedModelCalls: number
  unpricedModelCalls: number
}

/** Read the optional cross-package projection defensively from one list row. */
function apiCostOf(session: SessionSummary): ApiCostSnapshot | undefined {
  const candidate = session.projectionValues?.sessionStats
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const stats = candidate as Partial<ApiCostSnapshot>
  if (![stats.estimatedApiCostUsdNanos, stats.pricedModelCalls, stats.unpricedModelCalls]
    .every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return undefined
  return stats as ApiCostSnapshot
}

/** Format accumulated nanodollars for the wider dashboard card. */
function formatApiCost(nanos: number): string {
  if (nanos <= 0) return 'US$0.00'
  const usd = nanos / 1_000_000_000
  if (usd < 0.0001) return '<US$0.0001'
  return `US$${usd.toFixed(usd < 0.01 ? 4 : 2)}`
}

/**
 * Render the Leon Work overview inside the blank-session Hero.
 * @param props - Framework projections and dashboard actions.
 * @returns the dashboard region.
 */
export function WorkDashboard({ useSessions, useWorkspaces, startSession, openSession, t }: WorkDashboardProps) {
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const archived = new Set(workspaces.archivedSessionIds)
  const allSessions = sessions.ids
    .map(id => sessions.byId[id])
    .filter((session): session is SessionSummary => session !== undefined)
  const visible = allSessions
    .filter(session => session.origin !== 'subagent'
      && !archived.has(session.id))
  const recent = visible
    .filter(session => !session.blank)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 3)
  const running = visible.filter(session => session.running).length
  const waiting = visible.filter(session => session.pendingInteraction !== undefined).length
  const completed = visible.filter(session => session.completed === true).length
  // Billing scope is wider than dashboard navigation: archived and subagent
  // sessions still incurred real model calls and must remain in the estimate.
  const apiCosts = allSessions.map(apiCostOf).filter((value): value is ApiCostSnapshot => value !== undefined)
  const apiCostNanos = apiCosts.reduce((sum, value) => sum + value.estimatedApiCostUsdNanos, 0)
  const pricedModelCalls = apiCosts.reduce((sum, value) => sum + value.pricedModelCalls, 0)
  const unpricedModelCalls = apiCosts.reduce((sum, value) => sum + value.unpricedModelCalls, 0)

  const workspaceTitle = (sessionId: SessionId): string =>
    workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))?.title
      ?? t('workspace.ungrouped')

  const statusLabel = (session: SessionSummary): string => {
    const status = statusOf(session)
    return t(`status.${status}`)
  }

  return (
    <section className={css.root} data-leon-work-dashboard="" aria-label={t('aria')}>
      <header className={css.header}>
        <div className={css.heading}>
          <span className={css.eyebrow}><IconSparkle16 size={14} />{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
          <p>{t('description')}</p>
        </div>
        <button type="button" className={css.newTask} onClick={() => { startSession() }}>
          <IconNewChatOutline16 size={15} />
          <span>{t('newTask')}</span>
        </button>
      </header>

      <div className={css.metrics}>
        <Metric
          value={workspaces.items.length}
          label={t('metric.projects')}
          detail={t('metric.projects.detail')}
          tone="neutral"
        />
        <Metric
          value={running}
          label={t('metric.running')}
          detail={t('metric.running.detail')}
          tone="active"
        />
        <Metric
          value={waiting}
          label={t('metric.waiting')}
          detail={t('metric.waiting.detail')}
          tone="warning"
        />
        <Metric
          value={completed}
          label={t('metric.completed')}
          detail={t('metric.completed.detail')}
          tone="success"
        />
        <Metric
          value={formatApiCost(apiCostNanos)}
          label={t('metric.apiCost')}
          detail={unpricedModelCalls > 0
            ? t('metric.apiCost.unpriced', { count: unpricedModelCalls })
            : t('metric.apiCost.detail', { count: pricedModelCalls })}
          tone={unpricedModelCalls > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className={css.lower}>
        <section className={css.recent} aria-labelledby="leon-work-recent-title">
          <h3 id="leon-work-recent-title">{t('recent.title')}</h3>
          {recent.length === 0
            ? <p className={css.empty}>{t('recent.empty')}</p>
            : (
              <div className={css.recentList}>
                {recent.map((session) => {
                  const status = statusOf(session)
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className={css.recentRow}
                      aria-label={t('recent.open', { name: session.displayTitle })}
                      onClick={() => { openSession(session.id) }}
                    >
                      <span className={css.sessionIcon}><IconFolderOpenOutline16 size={15} /></span>
                      <span className={css.sessionText}>
                        <strong>{session.displayTitle}</strong>
                        <span>{workspaceTitle(session.id)}</span>
                      </span>
                      <span className={css.sessionStatus} data-status={status}>
                        <span aria-hidden="true" />
                        {statusLabel(session)}
                      </span>
                      <IconChevronRightOutline14 className={css.chevron} size={14} />
                    </button>
                  )
                })}
              </div>
            )}
        </section>

        <aside className={css.localFirst}>
          <span className={css.localIcon}><IconSparkle16 size={16} /></span>
          <span>
            <strong>{t('local.title')}</strong>
            <span>{t('local.detail')}</span>
          </span>
        </aside>
      </div>
    </section>
  )
}
