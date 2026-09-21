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

function memoryEntries(group: 'workspace' | 'personal', items: readonly MemoryAdminItem[]): Entry[] {
  return items.map(memory => ({
    key: `${group}:${memory.id}:${memory.revision}`,
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
  const loading = groups.some(group => sources[group].status === 'loading')
  const incomplete = groups.some(group => sources[group].status === 'error')
    || (workspace.status === 'ready' && workspace.value.hasMore)
    || (personal.status === 'ready' && personal.value.hasMore)
    || (capabilities.status === 'ready' && !capabilities.value.complete)
  const entryLabel = (entry: Entry): string => entry.memory === undefined ? entry.label
    : entry.memory.redacted ? t('memory.saved.redacted') : entry.memory.content ?? t('memory.overview.noContent')

  return (
    <section className={css.panel} aria-label={t('memory.overview.aria')} aria-busy={loading}>
      <div className={css.toolbar}>
        <p>{t('memory.overview.intro')}</p>
        <button type="button" onClick={refresh}>{t('memory.overview.refresh')}</button>
      </div>
      {incomplete ? <p role="status" className={css.warning}>{t('memory.overview.partial')}</p> : null}
      {capabilities.status === 'ready' ? (
        <p className={css.caption}>
          {t('memory.overview.preset', { value: capabilities.value.agentPreset ?? t('memory.overview.unknown') })}
          {' · '}{t('memory.overview.observed', { value: new Date(capabilities.value.observedAt).toLocaleString() })}
        </p>
      ) : null}
      <div className={css.layout}>
        <div className={css.inventory}>
          <figure className={css.graph}>
            <svg viewBox="0 0 690 250" role="img" aria-label={t('memory.overview.graph')}>
              {groups.map((group, groupIndex) => {
                const nodes = entries.filter(entry => entry.group === group).slice(0, graphLimit)
                const positions = new Map(nodes.map((entry, index) => [String(entry.memory?.id), {
                  x: 44 + (index % 4) * 47,
                  y: 113 + Math.floor(index / 4) * 43,
                }]))
                const graph = group === 'workspace' ? workspaceGraph : group === 'personal' ? personalGraph : undefined
                const links = graph === undefined || graph.status !== 'ready' ? []
                  : graph.value.edges.flatMap((edge) => {
                    const a = positions.get(String(edge.a))
                    const b = positions.get(String(edge.b))
                    return a === undefined || b === undefined ? []
                      : [{ key: `${String(edge.a)}:${String(edge.b)}`, a, b, score: edge.score }]
                  })
                return (
                  <g key={group} transform={`translate(${groupIndex * 230}, 0)`}>
                    <rect className={css.groupBox} x="8" y="8" width="214" height="230" rx="12" />
                    <text className={css.groupText} x="115" y="36" textAnchor="middle">{t(`memory.overview.group.${group}`)}</text>
                    <circle className={css.hub} cx="115" cy="66" r="12" />
                    {links.map(link => (
                      <line key={link.key} className={css.link}
                        x1={link.a.x} y1={link.a.y} x2={link.b.x} y2={link.b.y}
                        strokeWidth={0.5 + link.score * 2.5} />
                    ))}
                    {nodes.map((entry, index) => {
                      const x = 44 + (index % 4) * 47
                      const y = 113 + Math.floor(index / 4) * 43
                      return (
                        <g key={entry.key}>
                          <line className={css.edge} x1="115" y1="78" x2={x} y2={y} />
                          <circle className={entry.key === selected ? css.selectedNode : css.node} cx={x} cy={y} r="7" />
                        </g>
                      )
                    })}
                    <text className={css.groupText} x="115" y="224" textAnchor="middle">{t('memory.overview.nodes', { shown: String(nodes.length), total: String(entries.filter(entry => entry.group === group).length) })}</text>
                  </g>
                )
              })}
            </svg>
            <figcaption>{t('memory.overview.graphNotice')}</figcaption>
          </figure>
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
