/** Read-only projection of persisted memories and the current session skill catalog. */

import { useEffect, useState, type ReactNode } from 'react'
import type { SkillInspection } from '@deepseek-ai/dsh-api-remotes/client'
import type { MemoryAdminGraphValue, MemoryAdminItem, MemoryAdminListValue, PersonalMemoryAdminListValue } from '@deepseek-ai/dsh-tool-memory/types'
import type { MemoryReviewButtonProps } from './MemoryReviewButton.tsx'
import css from './MemoryOverviewPanel.module.css'

/** Read-only callbacks supplied by the containing session control. */
export type MemoryOverviewProps = Pick<MemoryReviewButtonProps,
  'sessionId' | 'useSessions' | 'listMemories' | 'listPersonalMemories' | 'listCapabilities'
  | 'memoryGraph' | 'personalMemoryGraph' | 't'>

type Source<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }
type Group = 'workspace' | 'personal' | 'skills'
type Entry = {
  key: string
  group: Group
  label: string
  memory?: MemoryAdminItem
  skill?: SkillInspection['skills'][number]
}
const groups = ['workspace', 'personal', 'skills'] as const
const statuses = ['active', 'scheduled', 'expired', 'superseded'] as const
const graphLimit = 12
const graphCenters = { workspace: { x: 188, y: 169 }, personal: { x: 505, y: 162 }, skills: { x: 350, y: 306 } }

function memoryKey(group: 'workspace' | 'personal', id: MemoryAdminItem['id'], revision: number): string {
  return `${group}:${id}:${revision}`
}

/** Display only public graph diagnostics, never a provider message or arbitrary error value. */
function graphFailureCode(code: string | undefined): string | undefined {
  return code !== undefined && [
    'computation-failed', 'graph-limit-exceeded', 'INPUT_TOO_LARGE', 'TIMEOUT',
    'TRANSPORT', 'HTTP_ERROR', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE',
  ].includes(code) ? code : undefined
}

function memoryEntries(group: 'workspace' | 'personal', items: readonly MemoryAdminItem[]): Entry[] {
  return items.map(memory => ({
    key: memoryKey(group, memory.id, memory.revision),
    group,
    label: String(memory.id),
    memory,
  }))
}

/**
 * Remount the inspected view whenever the host-projected session preset changes.
 * @param props - Session identity, read-only operations, framework hook and locale.
 * @returns Grouped catalog and memory inspection without mutations or model calls.
 */
export function MemoryOverviewPanel(props: MemoryOverviewProps): ReactNode {
  const preset = props.useSessions(state => state.byId[props.sessionId]?.agentPreset)
  return <OverviewBody key={`${props.sessionId}:${preset ?? ''}`} {...props} />
}

/** Fetch only on mount or explicit refresh; inspection never invokes a model or writes memory. */
function OverviewBody({
  sessionId, listMemories, listPersonalMemories, listCapabilities, memoryGraph, personalMemoryGraph, t,
}: MemoryOverviewProps): ReactNode {
  const [workspace, setWorkspace] = useState<Source<MemoryAdminListValue>>({ status: 'loading' })
  const [personal, setPersonal] = useState<Source<PersonalMemoryAdminListValue>>({ status: 'loading' })
  const [capabilities, setCapabilities] = useState<Source<SkillInspection>>({ status: 'loading' })
  const [workspaceGraph, setWorkspaceGraph] = useState<Source<MemoryAdminGraphValue>>({ status: 'loading' })
  const [personalGraph, setPersonalGraph] = useState<Source<MemoryAdminGraphValue>>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'graph' | 'records'>('graph')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let current = true
    void listMemories(sessionId, undefined, statuses).then(
      (value) => { if (current) setWorkspace({ status: 'ready', value }) },
      () => { if (current) setWorkspace({ status: 'error' }) },
    )
    void listPersonalMemories(sessionId).then(
      (value) => { if (current) setPersonal({ status: 'ready', value }) },
      () => { if (current) setPersonal({ status: 'error' }) },
    )
    void listCapabilities(sessionId).then(
      (value) => { if (current) setCapabilities({ status: 'ready', value }) },
      () => { if (current) setCapabilities({ status: 'error' }) },
    )
    void memoryGraph(sessionId).then(
      (value) => { if (current) setWorkspaceGraph({ status: 'ready', value }) },
      () => { if (current) setWorkspaceGraph({ status: 'error' }) },
    )
    void personalMemoryGraph(sessionId).then(
      (value) => { if (current) setPersonalGraph({ status: 'ready', value }) },
      () => { if (current) setPersonalGraph({ status: 'error' }) },
    )
    return () => { current = false }
  }, [sessionId, listMemories, listPersonalMemories, listCapabilities, memoryGraph, personalMemoryGraph, reload])

  const refresh = (): void => {
    setWorkspace({ status: 'loading' })
    setPersonal({ status: 'loading' })
    setCapabilities({ status: 'loading' })
    setWorkspaceGraph({ status: 'loading' })
    setPersonalGraph({ status: 'loading' })
    setSelected(null)
    setReload(value => value + 1)
  }
  const entries: Entry[] = [
    ...memoryEntries('workspace', workspace.status === 'ready' ? workspace.value.items : []),
    ...memoryEntries('personal', personal.status === 'ready' ? personal.value.items : []),
    ...(capabilities.status === 'ready' ? capabilities.value.skills.map(skill => ({
      key: `skills:${skill.name}`, group: 'skills' as const, label: skill.name, skill,
    })) : []),
  ]
  const active = entries.find(entry => entry.key === selected)
  const changes = entries.filter((entry): entry is Entry & { memory: MemoryAdminItem } => entry.memory !== undefined)
    .sort((a, b) => b.memory.updatedAt.localeCompare(a.memory.updatedAt))
  const sources = { workspace, personal, skills: capabilities }
  const graphs = { workspace: workspaceGraph, personal: personalGraph }
  const loading = groups.some(group => sources[group].status === 'loading')
    || workspaceGraph.status === 'loading' || personalGraph.status === 'loading'
  const incomplete = groups.some(group => sources[group].status === 'error')
    || (workspace.status === 'ready' && workspace.value.hasMore)
    || (personal.status === 'ready' && personal.value.hasMore)
    || (capabilities.status === 'ready' && !capabilities.value.complete)
  const entryLabel = (entry: Entry): string => entry.memory === undefined ? entry.label
    : entry.memory.redacted ? t('memory.saved.redacted') : entry.memory.content ?? t('memory.overview.noContent')
  const presetName = capabilities.status === 'ready' ? capabilities.value.agentPreset : null
  const countLabel = (group: Group): string => {
    const source = sources[group]
    if (source.status !== 'ready') return '—'
    const count = entries.filter(entry => entry.group === group && (entry.memory === undefined || entry.memory.status === 'active')).length
    const partial = group === 'skills' ? capabilities.status === 'ready' && !capabilities.value.complete
      : group === 'workspace' ? workspace.status === 'ready' && workspace.value.hasMore
        : personal.status === 'ready' && personal.value.hasMore
    return `${count}${partial ? '+' : ''}`
  }
  const latestDate = changes[0] === undefined ? undefined : new Date(changes[0].memory.updatedAt)
  const calendarYear = latestDate?.getFullYear()
  const calendarMonth = latestDate?.getMonth()
  const calendarStart = latestDate === undefined ? 0 : new Date(latestDate.getFullYear(), latestDate.getMonth(), 1).getDay()
  const calendarLength = latestDate === undefined ? 0 : new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0).getDate()
  const changedDays = new Set(changes.map(entry => new Date(entry.memory.updatedAt))
    .filter(date => date.getFullYear() === calendarYear && date.getMonth() === calendarMonth)
    .map(date => date.getDate()))

  return (
    <section className={css.panel} aria-label={t('memory.overview.aria')} aria-busy={loading}>
      <div className={css.toolbar}>
        <div><span className={css.eyebrow}>{t('memory.overview.workspaceTitle')}</span><h2>{t('memory.overview.title')}</h2><p>{t('memory.overview.intro')}</p></div>
        <button type="button" onClick={refresh}>{t('memory.overview.refresh')}</button>
      </div>
      {incomplete ? <p role="status" className={css.warning}>{t('memory.overview.partial')}</p> : null}
      <div className={css.layout}>
        <aside className={css.profile} aria-label={t('memory.overview.agentProfile')}>
          <div className={css.avatar} aria-hidden="true"><span>{presetName?.slice(0, 2).toUpperCase() ?? '?'}</span></div>
          <span className={css.eyebrow}>{t('memory.overview.agentProfile')}</span>
          <h3>{presetName ?? t('memory.overview.unknown')}</h3>
          <p className={css.profileState}>{t('memory.overview.readOnly')}</p>
          {capabilities.status === 'ready' ? <p className={css.caption}>{t('memory.overview.preset', { value: presetName ?? t('memory.overview.unknown') })}</p> : null}
          <dl className={css.metrics}>
            {groups.map(group => <div key={group} className={css[group]}><dt>{t(`memory.overview.group.${group}`)}</dt><dd>{countLabel(group)}</dd></div>)}
          </dl>
          <p className={css.caption}>{t('memory.overview.countsNotice')}</p>
          <div className={css.profileFoot}>
            <span className={css.eyebrow}>{t('memory.overview.observation')}</span>
            <p className={css.caption}>{capabilities.status === 'ready' ? t('memory.overview.observed', { value: new Date(capabilities.value.observedAt).toLocaleString() }) : t('memory.overview.unknown')}</p>
          </div>
        </aside>
        <div className={css.inventory}>
          <div className={css.mapToolbar}>
            <h3>{t('memory.overview.mapTitle')}</h3>
            <div className={css.viewToggle} aria-label={t('memory.overview.display')} role="group">
              <button type="button" aria-pressed={view === 'graph'} onClick={() => { setView('graph') }}>{t('memory.overview.graphView')}</button>
              <button type="button" aria-pressed={view === 'records'} onClick={() => { setView('records') }}>{t('memory.overview.recordsView')}</button>
            </div>
          </div>
          {view === 'graph' ? <figure className={css.graph}>
            <div className={css.graphCanvas}>
              <svg viewBox={`${350 - 350 / zoom} ${210 - 210 / zoom} ${700 / zoom} ${420 / zoom}`} role="group" aria-label={t('memory.overview.graph')}>
                {groups.map((group) => {
                  const nodes = entries.filter(entry => entry.group === group).slice(0, graphLimit)
                  const center = graphCenters[group]
                  const positioned = nodes.map((entry, index) => ({ entry,
                    x: center.x + Math.cos(index * 2.4) * (nodes.length === 1 ? 0 : 26 + Math.sqrt(index) * 23),
                    y: center.y + Math.sin(index * 2.4) * (nodes.length === 1 ? 0 : 22 + Math.sqrt(index) * 18),
                  }))
                  const positions = new Map(positioned.map(node => [node.entry.key, node]))
                  const graph = group === 'skills' ? undefined : graphs[group]
                  const links = group === 'skills' || graph?.status !== 'ready' || graph.value.status !== 'computed' ? []
                    : graph.value.edges.flatMap((edge) => {
                      const aKey = memoryKey(group, edge.a, edge.aRevision)
                      const bKey = memoryKey(group, edge.b, edge.bRevision)
                      const a = positions.get(aKey)
                      const b = positions.get(bKey)
                      return a === undefined || b === undefined ? []
                        : [{ key: JSON.stringify([aKey, bKey]), a, b, score: edge.score }]
                    })
                  return (
                    <g key={group} className={css[group]}>
                      <text className={css.groupText} x={center.x} y={center.y - 106} textAnchor="middle">{t(`memory.overview.group.${group}`)}</text>
                      {links.map(link => (
                        <line key={link.key} className={css.link}
                          x1={link.a.x} y1={link.a.y} x2={link.b.x} y2={link.b.y}
                          strokeWidth={0.5 + link.score * 2.5} />
                      ))}
                      {positioned.map(({ entry, x, y }, index) => {
                        return (
                          <g key={entry.key} className={css.graphNode} role="button" tabIndex={0}
                            aria-label={t('memory.overview.inspectNode', { index: String(index + 1), group: t(`memory.overview.group.${group}`) })}
                            aria-pressed={entry.key === selected} onClick={() => { setSelected(entry.key) }}
                            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(entry.key) } }}>
                            <title>{entryLabel(entry)}</title>
                            <circle className={css.nodeHalo} cx={x} cy={y} r="19" />
                            <circle className={entry.key === selected ? css.selectedNode : css.node}
                              cx={x} cy={y} r={entry.key === selected ? 10 : 7} />
                          </g>
                        )
                      })}
                      <text className={css.groupCount} x={center.x} y={center.y + 95} textAnchor="middle">{t('memory.overview.nodes', { shown: String(nodes.length), total: String(entries.filter(entry => entry.group === group).length) })}</text>
                    </g>
                  )
                })}
              </svg>
              <div className={css.zoomControls}>
                <button type="button" aria-label={t('memory.overview.zoomOut')} disabled={zoom <= 0.75} onClick={() => { setZoom(value => Math.max(0.75, value - 0.25)) }}>−</button>
                <button type="button" aria-label={t('memory.overview.zoomReset')} onClick={() => { setZoom(1) }}>{Math.round(zoom * 100)}%</button>
                <button type="button" aria-label={t('memory.overview.zoomIn')} disabled={zoom >= 2} onClick={() => { setZoom(value => Math.min(2, value + 0.25)) }}>+</button>
              </div>
            </div>
            <figcaption>{t('memory.overview.graphNotice')}</figcaption>
          </figure> : null}
          <div className={css.graphStatuses}>
            {(['workspace', 'personal'] as const).map((group) => {
              const graph = graphs[group]
              const status = graph.status === 'ready' ? graph.value.status : graph.status
              const failureCode = graph.status === 'ready' ? graphFailureCode(graph.value.failureCode) : undefined
              const label = t('memory.overview.graphStatus', { value: t(`memory.overview.group.${group}`) })
              return (
                <p key={group} className={css.graphStatus} aria-label={label} aria-atomic="true"
                  role={status === 'failed' || status === 'error' ? 'alert' : 'status'}>
                  <strong>{label}</strong>
                  <span>{t(`memory.overview.graphState.${status}`)}</span>
                  {failureCode === undefined ? null : <span>{t('memory.overview.graphFailureCode', { value: failureCode })}</span>}
                </p>
              )
            })}
          </div>
          <div className={css.records}>
            {groups.map(group => (
              <section key={group} className={css.group} aria-label={t(`memory.overview.group.${group}`)}>
                <h3>{t(`memory.overview.group.${group}`)}</h3>
                {sources[group].status === 'loading' ? <p>{t('memory.overview.loading')}</p> : null}
                {sources[group].status === 'error' ? <p role="alert">{t('memory.overview.sourceError', { value: t(`memory.overview.group.${group}`) })}</p> : null}
                {group === 'personal' && personal.status === 'ready' ? <p className={css.caption}>{personal.value.enabled ? t('memory.personal.enabledDetail') : t('memory.personal.disabledDetail')}</p> : null}
                {sources[group].status === 'ready' && !entries.some(entry => entry.group === group) ? <p>{t('memory.overview.empty')}</p> : null}
                <ul className={css.entries}>
                  {entries.filter(entry => entry.group === group).map(entry => (
                    <li key={entry.key}>
                      <button type="button" aria-pressed={selected === entry.key} onClick={() => { setSelected(entry.key) }}>
                        <span>{entryLabel(entry)}</span>
                        <small>{entry.memory === undefined
                          ? t('memory.overview.skillRecord')
                          : t(`memory.status.${entry.memory.status}`)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
        <aside className={css.detail} aria-label={t('memory.overview.details')}>
          <h3>{t('memory.overview.details')}</h3>
          {active === undefined ? <p>{t('memory.overview.select')}</p> : (
            <>
              <h4>{active.label}</h4>
              <p className={css.content}>{entryLabel(active)}</p>
              {active.memory !== undefined ? (
                <dl>
                  <dt>{t('memory.overview.partition')}</dt><dd>{t(`memory.overview.group.${active.group}`)}</dd>
                  <dt>{t('memory.overview.state')}</dt><dd>{t(`memory.status.${active.memory.status}`)}</dd>
                  <dt>{t('memory.overview.revision')}</dt><dd>{active.memory.revision}</dd>
                  <dt>{t('memory.overview.updated')}</dt><dd><time dateTime={active.memory.updatedAt}>{new Date(active.memory.updatedAt).toLocaleString()}</time></dd>
                </dl>
              ) : null}
              {active.skill !== undefined && capabilities.status === 'ready' ? (
                <>
                  <p className={css.content}>{active.skill.description}</p>
                  <dl>
                    <dt>{t('memory.overview.source')}</dt><dd>{active.skill.source}</dd>
                    <dt>{t('memory.overview.state')}</dt><dd>{!capabilities.value.complete ? t('memory.overview.unconfirmed')
                      : capabilities.value.modelToolAvailable && active.skill.modelInvocable ? t('memory.overview.available') : t('memory.overview.notAvailable')}</dd>
                    <dt>{t('memory.overview.directInvocation')}</dt><dd>{active.skill.userInvocable ? t('memory.overview.yes') : t('memory.overview.no')}</dd>
                    <dt>{t('memory.overview.authorization')}</dt><dd>{t('memory.overview.authorizationNotEvaluated')}</dd>
                    <dt>{t('memory.overview.lastTest')}</dt><dd>{t('memory.overview.noTest')}</dd>
                  </dl>
                </>
              ) : null}
            </>
          )}
          <h3>{t('memory.overview.changes')}</h3>
          {latestDate === undefined ? null : <section className={css.calendar} aria-label={t('memory.overview.calendar')}>
            <strong>{latestDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <div className={css.calendarGrid}>
              {t('memory.overview.weekdays').split(' ').map((day, index) => <span className={css.weekday} key={`weekday-${index}`}>{day}</span>)}
              {Array.from({ length: calendarStart + calendarLength }, (_, index) => {
                const day = index - calendarStart + 1
                return <span key={index} title={changedDays.has(day) ? t('memory.overview.updated') : undefined}
                  className={day > 0 && changedDays.has(day) ? css.changedDay : css.calendarDay}>{day > 0 ? day : ''}</span>
              })}
            </div>
            <p className={css.caption}>{t('memory.overview.calendarNotice')}</p>
          </section>}
          <p className={css.caption}>{t('memory.overview.changesNotice')}</p>
          <ol className={css.changes}>
            {changes.map(entry => (
              <li key={entry.key}>
                <button type="button" onClick={() => { setSelected(entry.key) }}>
                  <time dateTime={entry.memory.updatedAt}>{new Date(entry.memory.updatedAt).toLocaleString()}</time>
                  <span>{t(`memory.overview.group.${entry.group}`)} · {entryLabel(entry)}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  )
}
