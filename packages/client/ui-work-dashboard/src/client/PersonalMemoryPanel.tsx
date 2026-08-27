/** User-controlled personal memory shared across Leon workspaces. */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryAdminItem, PersonalMemoryAdminListValue } from '@deepseek-ai/dsh-tool-memory/types'
import css from './MemoryReviewButton.module.css'

/** Host operations exposed to the owner-isolated personal-memory panel. */
export interface PersonalMemoryInjected {
  listPersonalMemories: (sessionId: SessionId, query?: string) => Promise<PersonalMemoryAdminListValue>
  rememberPersonalMemory: (sessionId: SessionId, content: string) => Promise<MemoryAdminItem>
  correctPersonalMemory: (sessionId: SessionId, item: MemoryAdminItem, content: string) => Promise<MemoryAdminItem>
  forgetPersonalMemory: (sessionId: SessionId, item: MemoryAdminItem) => Promise<void>
  setPersonalMemoryEnabled: (sessionId: SessionId, enabled: boolean) => Promise<boolean>
}

/** Props supplied by the parent memory dialog. */
export type PersonalMemoryPanelProps = PropsLocale<'work-dashboard'> & PersonalMemoryInjected & {
  readonly sessionId: SessionId
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
    readonly status: 'ready'
    readonly items: readonly MemoryAdminItem[]
    readonly readOnly: boolean
    readonly enabled: boolean
  }

type Confirmation =
  | { readonly action: 'remember'; readonly content: string }
  | { readonly action: 'correct'; readonly item: MemoryAdminItem; readonly content: string }
  | { readonly action: 'forget'; readonly item: MemoryAdminItem }
  | { readonly action: 'toggle'; readonly enabled: boolean }

function memoryKey(item: MemoryAdminItem): string {
  return `${String(item.id)}:${item.revision}`
}

/** Render explicit, reversible controls over the local personal-memory partition. */
export function PersonalMemoryPanel({
  sessionId,
  listPersonalMemories,
  rememberPersonalMemory,
  correctPersonalMemory,
  forgetPersonalMemory,
  setPersonalMemoryEnabled,
  t,
}: PersonalMemoryPanelProps): ReactNode {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [reload, setReload] = useState(1)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<'remembered' | 'corrected' | 'forgotten' | 'toggled' | null>(null)

  const load = useCallback((): void => {
    setState({ status: 'loading' })
    setReload(value => value + 1)
  }, [])

  useEffect(() => {
    let current = true
    void listPersonalMemories(sessionId, query.length === 0 ? undefined : query).then(
      (value) => {
        if (current) setState({
          status: 'ready',
          items: value.items,
          readOnly: value.readOnly,
          enabled: value.enabled,
        })
      },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listPersonalMemories, query, reload, sessionId])

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault()
    setQuery(queryDraft.trim())
    load()
  }

  const confirm = async (target: Confirmation): Promise<void> => {
    setBusy(true)
    setFeedback(null)
    try {
      if (target.action === 'remember') {
        const item = await rememberPersonalMemory(sessionId, target.content)
        setState(previous => previous.status === 'ready'
          ? { ...previous, items: [item, ...previous.items] }
          : previous)
        setNewContent('')
        setFeedback('remembered')
      } else if (target.action === 'correct') {
        const item = await correctPersonalMemory(sessionId, target.item, target.content)
        setState(previous => previous.status === 'ready'
          ? {
            ...previous,
            items: previous.items.map(current => memoryKey(current) === memoryKey(target.item) ? item : current),
          }
          : previous)
        setEditing(null)
        setFeedback('corrected')
      } else if (target.action === 'forget') {
        await forgetPersonalMemory(sessionId, target.item)
        setState(previous => previous.status === 'ready'
          ? { ...previous, items: previous.items.filter(item => item.id !== target.item.id) }
          : previous)
        setEditing(null)
        setFeedback('forgotten')
      } else {
        const enabled = await setPersonalMemoryEnabled(sessionId, target.enabled)
        setState(previous => previous.status === 'ready' ? { ...previous, enabled } : previous)
        setFeedback('toggled')
      }
      setConfirmation(null)
    } catch {
      setState({ status: 'error' })
      setConfirmation(null)
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <p className={css.status}>{t('memory.personal.loading')}</p>
  if (state.status === 'error') {
    return (
      <div className={css.failure} role="alert">
        <p>{t('memory.personal.error')}</p>
        <button type="button" onClick={load}>{t('memory.retry')}</button>
      </div>
    )
  }

  return (
    <section className={css.saved} aria-busy={busy}>
      <div className={css.personalControl}>
        <div>
          <strong>{t('memory.personal.enabledTitle')}</strong>
          <p>{state.enabled ? t('memory.personal.enabledDetail') : t('memory.personal.disabledDetail')}</p>
        </div>
        <button
          type="button"
          className={state.enabled ? css.danger : undefined}
          disabled={busy}
          onClick={() => { setConfirmation({ action: 'toggle', enabled: !state.enabled }) }}
        >
          {state.enabled ? t('memory.personal.disable') : t('memory.personal.enable')}
        </button>
      </div>

      <form className={css.personalComposer} onSubmit={(event) => {
        event.preventDefault()
        const content = newContent.trim()
        if (content.length > 0) setConfirmation({ action: 'remember', content })
      }}>
        <label htmlFor="personal-memory-new">{t('memory.personal.addLabel')}</label>
        <textarea
          id="personal-memory-new"
          className={css.editor}
          rows={3}
          value={newContent}
          disabled={!state.enabled || state.readOnly || busy}
          onChange={(event) => { setNewContent(event.currentTarget.value) }}
          placeholder={t('memory.personal.addPlaceholder')}
        />
        <button type="submit" disabled={!state.enabled || state.readOnly || busy || newContent.trim().length === 0}>
          {t('memory.personal.reviewAdd')}
        </button>
      </form>

      <form className={css.filters} onSubmit={submitSearch}>
        <label className={css.srOnly} htmlFor="personal-memory-search">{t('memory.personal.search')}</label>
        <input
          id="personal-memory-search"
          value={queryDraft}
          onChange={(event) => { setQueryDraft(event.currentTarget.value) }}
          placeholder={t('memory.personal.search')}
        />
        <button type="submit">{t('memory.saved.filter')}</button>
      </form>

      {state.readOnly ? <p className={css.readOnly}>{t('memory.saved.readOnly')}</p> : null}
      {state.items.length === 0 ? <p className={css.status}>{t('memory.personal.empty')}</p> : (
        <ul className={css.list}>
          {state.items.map((item) => {
            const key = memoryKey(item)
            const isEditing = editing === key
            return (
              <li className={css.card} key={key} data-personal-memory={key}>
                <div className={css.meta}>
                  <span className={css.badge}>{t(`memory.status.${item.status}`)}</span>
                  <span>{t('memory.saved.revision', { value: String(item.revision) })}</span>
                  <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
                </div>
                {isEditing ? (
                  <textarea
                    className={css.editor}
                    rows={4}
                    value={editContent}
                    aria-label={t('memory.personal.editLabel')}
                    onChange={(event) => { setEditContent(event.currentTarget.value) }}
                  />
                ) : <p className={css.content}>{item.content ?? t('memory.saved.redacted')}</p>}
                <div className={css.actions}>
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        disabled={!state.enabled || busy || editContent.trim().length === 0 || editContent.trim() === item.content}
                        onClick={() => { setConfirmation({ action: 'correct', item, content: editContent.trim() }) }}
                      >
                        {t('memory.saved.reviewCorrection')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setEditing(null) }}>{t('memory.cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!state.enabled || state.readOnly || item.redacted || busy}
                        onClick={() => {
                          setEditing(key)
                          setEditContent(item.content ?? '')
                        }}
                      >
                        {t('memory.saved.correct')}
                      </button>
                      <button
                        className={css.danger}
                        type="button"
                        disabled={state.readOnly || busy}
                        onClick={() => { setConfirmation({ action: 'forget', item }) }}
                      >
                        {t('memory.saved.forget')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmation !== null ? (
        <div className={css.confirmation} role="alert">
          <p>{confirmationText(confirmation, state.enabled, t)}</p>
          <div className={css.actions}>
            <button type="button" disabled={busy} onClick={() => { void confirm(confirmation) }}>
              {t('memory.confirm.action')}
            </button>
            <button type="button" disabled={busy} onClick={() => { setConfirmation(null) }}>{t('memory.cancel')}</button>
          </div>
        </div>
      ) : null}

      {feedback !== null ? <p className={css.notice} role="status">{t(`memory.personal.feedback.${feedback}`)}</p> : null}
      <p className={css.notice}>{t('memory.personal.notice')}</p>
    </section>
  )
}

function confirmationText(
  confirmation: Confirmation,
  currentlyEnabled: boolean,
  t: PersonalMemoryPanelProps['t'],
): string {
  if (confirmation.action === 'remember') return t('memory.personal.confirm.remember')
  if (confirmation.action === 'correct') return t('memory.confirm.correct')
  if (confirmation.action === 'forget') return t('memory.personal.confirm.forget')
  return currentlyEnabled ? t('memory.personal.confirm.disable') : t('memory.personal.confirm.enable')
}
