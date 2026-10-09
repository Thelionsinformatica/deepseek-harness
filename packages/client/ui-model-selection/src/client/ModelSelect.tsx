/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Searchable provider groups and a details panel project Host metadata.
 * Adaptive and team routing use the same selection RPC as explicit models;
 * configured team roles do not prove delegated execution or review.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelProviderGroup, ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** The searchable catalog or one mode's explicit settings. */
type Pane = 'root' | 'effort' | 'automatic' | 'team'

/** One advertised route; identity uses both ids, never a display name. */
interface ModelChoice {
  group: ModelProviderGroup
  model: ModelProviderGroup['models'][number]
}

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, searchable routes with Host-owned details.
 */
export function ModelSelect(
  { locked, available, directory, load, select, selectAutomatic, selectTeam, useSession, t }:
  ModelSelectInjected & { locked: boolean; useSession: SnapshotSelectorHook<ConversationSnapshot> } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  const [inspected, setInspected] = useState<ModelSelection | null>(null)
  const [externalFailoverConsent, setExternalFailoverConsent] = useState(false)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const running = useSession(snapshot => snapshot.running)
  const failoverSeq = useSession(snapshot =>
    snapshot.nodes.findLast(node => node.kind === 'model-failover')?.seq ?? null)
  const previousRunning = useRef(false)
  const previousFailoverSeq = useRef(failoverSeq)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo<ModelChoice[]>(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.group.id === state.current?.provider && c.model.id === state.current.model)
  const currentChoice = choices[selectedIndex]
  const inspectedChoice = choices.find(choice =>
    choice.group.id === inspected?.provider && choice.model.id === inspected.model) ?? currentChoice
  const filteredGroups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return state.groups.map(group => ({
      ...group,
      models: group.models.filter(model =>
        `${group.id} ${group.name} ${model.id} ${model.name} ${model.description ?? ''}`
          .toLocaleLowerCase().includes(search)),
    })).filter(group => group.models.length > 0)
  }, [query, state.groups])
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  // The Host chooses the tier immediately before admitting an idle prompt.
  // Refresh on the running edge so the corner indicator names the route that
  // actually entered the request, not merely the pre-turn default.
  useEffect(() => {
    const started = running && !previousRunning.current
    previousRunning.current = running
    if (!started || !state.automatic) return
    lastActionRef.current = 'load'
    load()
  }, [load, running, state.automatic])

  // Automatic failover changes the Host selection inside an active turn, so
  // the running edge has already passed. Refresh when its durable notice lands.
  useEffect(() => {
    const changed = failoverSeq !== null && failoverSeq !== previousFailoverSeq.current
    previousFailoverSeq.current = failoverSeq
    if (!changed || !state.automatic) return
    lastActionRef.current = 'load'
    load()
  }, [failoverSeq, load, state.automatic])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (open && pane === 'root') searchRef.current?.focus()
  }, [open, pane])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setQuery('')
    setInspected(null)
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null && !item.disabled)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = active < 0
      ? offset > 0 ? 0 : items.length - 1
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else if (query.length > 0) setQuery('')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (!state.automatic && state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (!state.automatic && effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const configureAutomatic = (): void => {
    setExternalFailoverConsent(state.externalFailoverConsent)
    setPane('automatic')
  }

  const chooseAutomatic = (): void => {
    lastActionRef.current = 'select'
    void selectAutomatic(externalFailoverConsent).then(settleSelection)
  }

  const chooseTeam = (): void => {
    lastActionRef.current = 'select'
    void selectTeam().then(settleSelection)
  }

  const routeLabel = (selection: ModelSelection): string => {
    const choice = choices.find(item => item.group.id === selection.provider && item.model.id === selection.model)
    return choice === undefined
      ? `${selection.provider} · ${selection.model}`
      : `${choice.group.name} · ${choice.model.name}`
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerModelLabel = state.selectionMode === 'team' ? t('team.name')
    : state.automatic ? t('automatic.name') : modelLabel
  const triggerDetail = state.automatic
    ? effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
    : effortLabel
  const triggerLabel = triggerDetail === undefined ? triggerModelLabel : `${triggerModelLabel} · ${triggerDetail}`
  const triggerAria = state.selectionMode === 'team'
    ? t('trigger.ariaTeam', { model: modelLabel })
    : state.automatic
      ? effortLabel === undefined
        ? t('trigger.ariaAutomatic', { model: modelLabel })
        : t('trigger.ariaAutomaticEffort', { model: modelLabel, effort: effortLabel })
      : currentChoice === undefined
        ? t('trigger.selectAria')
        : effortLabel === undefined
          ? t('trigger.aria', { model: modelLabel })
          : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{triggerModelLabel}</span>
        {triggerDetail !== undefined && <span className={css.triggerEffort}>{triggerDetail}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={clsx(css.menu, pane === 'root' && css.catalogMenu)}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <div className={css.catalogLayout}>
              <div className={css.catalogList}>
                <input
                  ref={searchRef}
                  className={css.search}
                  type="search"
                  value={query}
                  aria-label={t('search.label')}
                  placeholder={t('search.placeholder')}
                  onChange={(event) => { setQuery(event.target.value) }}
                />
                {state.automaticAvailable && (
                  <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={configureAutomatic}>
                    <span className={css.cellLabel}>{t('automatic.name')}</span>
                    <span className={css.check}>{state.selectionMode === 'adaptive' ? <IconCheckOutline16 /> : null}</span>
                    <IconChevronRightOutline14 className={css.cellChevron} />
                  </button>
                )}
                {state.coordination !== undefined && (
                  <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('team') }}>
                    <span className={css.cellLabel}>{t('team.name')}</span>
                    <span className={css.check}>{state.selectionMode === 'team' ? <IconCheckOutline16 /> : null}</span>
                    <IconChevronRightOutline14 className={css.cellChevron} />
                  </button>
                )}
                {reasoning !== undefined && (
                  <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                    <span className={css.cellLabel}>{t('menu.effort')}</span>
                    <span className={css.cellValue}>{effortLabel}</span>
                    <IconChevronRightOutline14 className={css.cellChevron} />
                  </button>
                )}
                <div className={css.groupTitle}>{t('menu.model')}</div>
                {state.status === 'loading' && (
                  <div className={css.status}>{t('status.loading')}</div>
                )}
                {state.error !== null && lastActionRef.current === 'load' && (
                  <div className={css.error}>
                    <span>{t('error.action', { message: state.error })}</span>
                    <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                  </div>
                )}
                {state.failures.map(failure => (
                  <div className={css.warning} key={failure.id}>
                    <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                    <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                  </div>
                ))}
                <div className={clsx(css.groups, 'scrollable')}>
                  {filteredGroups.map((group) => {
                    const headingId = `${id}-${group.id}`
                    return (
                      <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                        <div className={css.groupTitle} id={headingId}>{group.name}</div>
                        {group.models.map((model) => {
                          const selected = state.selectionMode === 'manual'
                          && state.current?.provider === group.id && state.current.model === model.id
                          return (
                            <button
                              ref={itemRef()}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              className={clsx(css.option, selected && css.selected)}
                              key={model.id}
                              title={model.name}
                              disabled={busy}
                              onMouseEnter={() => { setInspected({ provider: group.id, model: model.id }) }}
                              onFocus={() => { setInspected({ provider: group.id, model: model.id }) }}
                              onClick={() => { choose({ provider: group.id, model: model.id }) }}
                            >
                              <span className={css.optionCopy}>
                                <span className={css.modelName}>{model.name}</span>
                                {model.description !== undefined && (
                                  <span className={css.description}>{model.description}</span>
                                )}
                              </span>
                              <span className={css.check}>
                                {selected ? <IconCheckOutline16 /> : null}
                              </span>
                            </button>
                          )
                        })}
                      </section>
                    )
                  })}
                </div>
                {state.status === 'ready' && filteredGroups.length === 0 && (
                  <div className={css.empty}>{choices.length === 0 ? t('empty.models') : t('search.empty')}</div>
                )}
                <div className={css.catalogFootnote}>{t('details.catalogWarning')}</div>
              </div>
              <section role="region" aria-label={t('details.label')} className={clsx(css.details, 'scrollable')}>
                <div className={css.modelName}>{inspectedChoice?.model.name ?? modelLabel}</div>
                <p className={css.detailDescription}>{inspectedChoice?.model.description ?? t('menu.guidance')}</p>
                <dl className={css.detailValues}>
                  <dt>{t('details.provider')}</dt><dd>{inspectedChoice?.group.name ?? t('details.unknown')}</dd>
                  <dt>{t('details.modelId')}</dt><dd>{inspectedChoice?.model.id ?? t('details.unknown')}</dd>
                  <dt>{t('details.input')}</dt><dd>{inspectedChoice?.model.inputModalities === undefined
                    ? t('details.unknown')
                    : inspectedChoice.model.inputModalities.map(modality => t(`details.modality.${modality}`)).join(' · ')}</dd>
                  <dt>{t('details.context')}</dt><dd>{inspectedChoice?.model.context === undefined
                    ? t('details.unknown') : t('details.tokens', { count: inspectedChoice.model.context.contextWindow })}</dd>
                  <dt>{t('details.output')}</dt><dd>{inspectedChoice?.model.defaultMaxTokens === undefined
                    ? t('details.unknown') : t('details.tokens', { count: inspectedChoice.model.defaultMaxTokens })}</dd>
                  <dt>{t('details.efforts')}</dt><dd>{inspectedChoice?.model.reasoning?.efforts.map(effort => effort.name).join(' · ')
                  ?? t('details.unknown')}</dd>
                  <dt>{t('details.price')}</dt><dd>{t('details.unknown')}</dd>
                </dl>
                <p className={css.detailDescription}>{t('details.catalogWarning')}</p>
                <p className={css.detailDescription}>{t('details.modeLifetime')}</p>
              </section>
            </div>
          )}

          {pane === 'automatic' && (
            <>
              <div className={css.automaticSummary}>
                <span className={css.modelName}>{t('automatic.name')}</span>
                <span className={clsx(css.description, css.wrappingDescription)}>
                  {t('automatic.description')}
                </span>
                <span className={clsx(css.description, css.wrappingDescription)}>{t('details.modeLifetime')}</span>
              </div>
              {state.externalFailoverAvailable && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={externalFailoverConsent}
                  className={clsx(css.option, externalFailoverConsent && css.selected)}
                  disabled={busy}
                  onClick={() => { setExternalFailoverConsent(value => !value) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.modelName}>{t('automatic.externalConsent.name')}</span>
                    <span className={clsx(css.description, css.wrappingDescription)}>
                      {t('automatic.externalConsent.description')}
                    </span>
                  </span>
                  <span className={css.check}>
                    {externalFailoverConsent ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              )}
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className={clsx(css.option, css.automaticAction)}
                disabled={busy}
                onClick={chooseAutomatic}
              >
                <span className={css.modelName}>
                  {state.automatic ? t('automatic.action.save') : t('automatic.action.enable')}
                </span>
              </button>
            </>
          )}

          {pane === 'team' && state.coordination !== undefined && (
            <>
              <div className={css.automaticSummary}>
                <span className={css.modelName}>{t('team.name')}</span>
                <span className={clsx(css.description, css.wrappingDescription)}>{t('team.description')}</span>
              </div>
              <dl className={css.roleValues}>
                <dt>{t('team.coordinator')}</dt><dd>{routeLabel(state.coordination.coordinator)}</dd>
                <dt>{t('team.worker')}</dt><dd>{state.coordination.worker === undefined
                  ? t('team.notConfigured') : routeLabel(state.coordination.worker)}</dd>
                <dt>{t('team.review')}</dt><dd>{state.coordination.review === undefined
                  ? t('team.notConfigured') : routeLabel(state.coordination.review)}</dd>
                <dt>{t('team.vision')}</dt><dd>{state.coordination.vision === undefined
                  ? t('team.notConfigured') : routeLabel(state.coordination.vision)}</dd>
              </dl>
              <p className={css.modeWarning}>{t('team.executionWarning')}</p>
              <p className={css.modeWarning}>{t('details.modeLifetime')}</p>
              <button ref={itemRef()} type="button" role="menuitem" className={clsx(css.option, css.automaticAction)}
                disabled={busy} onClick={chooseTeam}>
                <span className={css.modelName}>{t('team.action')}</span>
              </button>
            </>
          )}

          {pane !== 'root' && (
            <button ref={itemRef()} type="button" role="menuitem" className={css.cell}
              onClick={() => { setPane('root') }}>
              <span>{t('menu.back')}</span>
            </button>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
