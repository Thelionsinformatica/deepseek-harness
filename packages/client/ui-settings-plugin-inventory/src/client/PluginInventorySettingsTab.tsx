import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /** Toggle only a Host-audited optional plugin in the current process. */
  setEnabled: (entryId: PluginInventorySnapshot['entries'][number]['entryId'], enabled: boolean) => Promise<PluginInventorySnapshot['entries'][number]>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']
type PluginActivationMode = PluginInventoryEntry['activation']
type PluginCategory = PluginInventoryEntry['category']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

const ACTIVATION_KEYS = {
  'live-toggle': 'liveToggle',
  'restart-required': 'restartRequired',
  protected: 'protected',
} satisfies Record<PluginActivationMode, PluginInventoryLocaleKey>

const CATEGORY_KEYS = {
  'web-provider': 'categoryWebProvider',
  tool: 'categoryTool',
  'client-interface': 'categoryClientInterface',
  'host-runtime': 'categoryHostRuntime',
  'agent-runtime': 'categoryAgentRuntime',
  extension: 'categoryExtension',
  other: 'categoryOther',
} satisfies Record<PluginCategory, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Localized management label for a conservative host classification. */
function activationLabel(
  activation: PluginActivationMode,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return t(ACTIVATION_KEYS[activation])
}

/** Localized purpose label for a non-secret inferred category. */
function categoryLabel(
  category: PluginCategory,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return t(CATEGORY_KEYS[category])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId, entry.category, entry.summary, ...entry.capabilities]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render the Plugin Center with details and only Host-audited live toggles. */
export function PluginInventorySettingsTab({ list, setEnabled, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const alive = useRef(true)
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [changing, setChanging] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [actionFailure, setActionFailure] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    alive.current = true
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => {
      current = false
      alive.current = false
    }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setActionFailure(null)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const change = (entry: PluginInventoryEntry, enabled: boolean): void => {
    if (entry.activation !== 'live-toggle' || changing !== null) return
    setChanging(entry.entryId)
    setActionFailure(null)
    void setEnabled(entry.entryId, enabled).then((updated) => {
      if (!alive.current) return
      setState(current => current.status !== 'ready' ? current : {
        status: 'ready',
        snapshot: {
          entries: current.snapshot.entries.map(candidate =>
            candidate.entryId === updated.entryId ? updated : candidate),
        },
      })
      setChanging(null)
    }, (reason: unknown) => {
      if (!alive.current) return
      setChanging(null)
      setActionFailure(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          {actionFailure !== null ? <p className={css.actionFailure} role="status" title={actionFailure}>{t('actionError')}</p> : null}
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const activation = activationLabel(entry.activation, t)
                const open = expanded === entry.entryId
                const updating = changing === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={entry.enabled ? `${title}, ${status}, ${configuration}, ${activation}` : `${title}, ${configuration}, ${activation}`}
                      onClick={() => {
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                      }}
                    >
                      <span className={css.cardLeading}>
                        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                        <span className={css.summary}>{entry.summary}</span>
                      </span>
                      <span className={css.cardTrailing}>
                        {entry.enabled ? (
                          <span
                            className={css.statusDot}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            role="img"
                            aria-label={status}
                            title={status}
                          />
                        ) : null}
                        <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                          {configuration}
                        </span>
                        <span className={css.activationTag} data-activation={entry.activation}>{activation}</span>
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>{t('purpose')}</dt>
                            <dd>{categoryLabel(entry.category, t)}</dd>
                          </div>
                          <div>
                            <dt>{t('capabilities')}</dt>
                            <dd className={css.capabilities}>
                              {entry.capabilities.map(capability => <span key={capability}>{capability}</span>)}
                            </dd>
                          </div>
                          <div>
                            <dt>{t('management')}</dt>
                            <dd>{entry.activationReason}</dd>
                          </div>
                        </dl>
                        {entry.activation === 'live-toggle' ? (
                          <button
                            type="button"
                            className={css.toggle}
                            disabled={updating}
                            onClick={() => { change(entry, !entry.enabled) }}
                          >
                            {updating ? t('updating') : t(entry.enabled ? 'disableNow' : 'enableNow')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
