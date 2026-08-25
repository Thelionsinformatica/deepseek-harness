/** Session-header control for candidate review and workspace memory administration. */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconArchiveOutline20, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  MemoryAdminItem,
  MemoryAdminListValue,
  MemoryAdminStatus,
  MemoryCandidateReviewDecision,
  MemoryCandidateReviewItem,
  MemoryCandidateReviewListValue,
} from '@deepseek-ai/dsh-tool-memory/types'
import type { WorkDashboardKey } from './locales.ts'
import css from './MemoryReviewButton.module.css'

/** Registration-side Host Remote face for the memory control. */
export interface MemoryReviewInjected {
  list: (sessionId: SessionId) => Promise<MemoryCandidateReviewListValue>
  review: (
    sessionId: SessionId,
    id: MemoryCandidateReviewItem['id'],
    decision: MemoryCandidateReviewDecision,
  ) => Promise<MemoryCandidateReviewItem>
  listMemories: (
    sessionId: SessionId,
    query?: string,
    statuses?: readonly MemoryAdminStatus[],
  ) => Promise<MemoryAdminListValue>
  correctMemory: (sessionId: SessionId, item: MemoryAdminItem, content: string) => Promise<MemoryAdminItem>
  forgetMemory: (sessionId: SessionId, item: MemoryAdminItem) => Promise<void>
}

/** Full props composed by the session-header slot renderer. */
export type MemoryReviewButtonProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'work-dashboard'>
  & InjectFace<MemoryReviewInjected>

type CandidateViewState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly MemoryCandidateReviewItem[] }

type MemoryViewState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly MemoryAdminItem[]; readonly readOnly: boolean }

type DecisionFeedback = 'reviewed' | 'stored' | null
type MemoryFeedback = 'corrected' | 'forgotten' | null
type Tab = 'suggestions' | 'saved'
type StatusFilter = MemoryAdminStatus | 'all'
const allMemoryStatuses = ['active', 'scheduled', 'expired', 'superseded'] as const satisfies readonly MemoryAdminStatus[]
type Confirmation =
  | { readonly action: 'correct'; readonly item: MemoryAdminItem; readonly content: string }
  | { readonly action: 'forget'; readonly item: MemoryAdminItem }

function canAccept(item: MemoryCandidateReviewItem): boolean {
  return item.candidateContent !== undefined
    && item.sensitivity !== 'blocked'
    && item.policyDecision !== 'block'
    && item.policyDecision !== 'reject'
}

function readableToken(value: string): string {
  return value.replaceAll('-', ' ')
}

function memoryKey(item: MemoryAdminItem): string {
  return `${String(item.id)}:${item.revision}`
}

/** Open candidate review and durable memory administration for one Session workspace. */
export function MemoryReviewButton({
  sessionId, list, review, listMemories, correctMemory, forgetMemory, t,
}: MemoryReviewButtonProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('suggestions')
  const [candidateReload, setCandidateReload] = useState(0)
  const [memoryReload, setMemoryReload] = useState(0)
  const [candidateBusy, setCandidateBusy] = useState<MemoryCandidateReviewItem['id'] | null>(null)
  const [memoryBusy, setMemoryBusy] = useState<string | null>(null)
  const [candidateState, setCandidateState] = useState<CandidateViewState>({ status: 'idle' })
  const [memoryState, setMemoryState] = useState<MemoryViewState>({ status: 'idle' })
  const [feedback, setFeedback] = useState<DecisionFeedback>(null)
  const [memoryFeedback, setMemoryFeedback] = useState<MemoryFeedback>(null)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const loadCandidates = useCallback((): void => {
    setCandidateState({ status: 'loading' })
    setCandidateReload(value => value + 1)
  }, [])

  const loadSaved = useCallback((): void => {
    setMemoryState({ status: 'loading' })
    setMemoryReload(value => value + 1)
  }, [])

  useEffect(() => {
    if (!open || candidateReload === 0) return
    let current = true
    void list(sessionId).then(
      (value) => { if (current) setCandidateState({ status: 'ready', items: value.items }) },
      () => { if (current) setCandidateState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [candidateReload, list, open, sessionId])

  useEffect(() => {
    if (!open || tab !== 'saved' || memoryReload === 0) return
    let current = true
    const statuses = statusFilter === 'all' ? allMemoryStatuses : [statusFilter]
    void listMemories(sessionId, query.length === 0 ? undefined : query, statuses).then(
      (value) => {
        if (current) setMemoryState({ status: 'ready', items: value.items, readOnly: value.readOnly })
      },
      () => { if (current) setMemoryState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listMemories, memoryReload, open, query, sessionId, statusFilter, tab])

  const show = (): void => {
    setOpen(true)
    setTab('suggestions')
    setFeedback(null)
    setMemoryFeedback(null)
    setConfirmation(null)
    loadCandidates()
  }

  const selectTab = (next: Tab): void => {
    setTab(next)
    setConfirmation(null)
    if (next === 'saved' && memoryState.status === 'idle') loadSaved()
  }

  const decide = async (
    item: MemoryCandidateReviewItem,
    decision: Extract<MemoryCandidateReviewDecision, 'accept' | 'reject'>,
  ): Promise<void> => {
    setCandidateBusy(item.id)
    try {
      const reviewed = await review(sessionId, item.id, decision)
      setFeedback(reviewed.autoWrite?.status === 'stored' ? 'stored' : 'reviewed')
      setCandidateState(previous => previous.status === 'ready'
        ? { status: 'ready', items: previous.items.filter(candidate => candidate.id !== item.id) }
        : previous)
    } catch {
      setCandidateState({ status: 'error' })
    } finally {
      setCandidateBusy(null)
    }
  }

  const submitFilter = (event: FormEvent): void => {
    event.preventDefault()
    setQuery(queryDraft.trim())
    loadSaved()
  }

  const startCorrection = (item: MemoryAdminItem): void => {
    setEditing(memoryKey(item))
    setEditContent(item.content ?? '')
    setConfirmation(null)
  }

  const requestCorrection = (item: MemoryAdminItem): void => {
    setConfirmation({ action: 'correct', item, content: editContent.trim() })
  }

  const confirmMutation = async (target: Confirmation): Promise<void> => {
    setMemoryBusy(memoryKey(target.item))
    try {
      if (target.action === 'correct') {
        const corrected = await correctMemory(sessionId, target.item, target.content)
        setMemoryState(previous => previous.status === 'ready'
          ? {
            ...previous,
            items: previous.items.map(item => memoryKey(item) === memoryKey(target.item) ? corrected : item),
          }
          : previous)
        setMemoryFeedback('corrected')
      } else {
        await forgetMemory(sessionId, target.item)
        setMemoryState(previous => previous.status === 'ready'
          ? { ...previous, items: previous.items.filter(item => item.id !== target.item.id) }
          : previous)
        setMemoryFeedback('forgotten')
      }
      setEditing(null)
      setConfirmation(null)
    } catch {
      setMemoryState({ status: 'error' })
      setConfirmation(null)
    } finally {
      setMemoryBusy(null)
    }
  }

  return (
    <>
      <button className={css.trigger} type="button" onClick={show} title={t('memory.open')}>
        <IconArchiveOutline20 size={15} aria-hidden="true" />
        <span>{t('memory.open')}</span>
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('memory.title')}
        description={t('memory.description')}
        closeLabel={t('memory.close')}
        contentClassName={css.modalContent as string}
      >
        <div className={css.body}>
          <div className={css.tabs} role="tablist" aria-label={t('memory.tabs.label')}>
            <button type="button" role="tab" aria-selected={tab === 'suggestions'} onClick={() => { selectTab('suggestions') }}>
              {t('memory.tabs.suggestions')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => { selectTab('saved') }}>
              {t('memory.tabs.saved')}
            </button>
          </div>

          {tab === 'suggestions' ? (
            <section aria-busy={candidateState.status === 'loading'}>
              {candidateState.status === 'loading' || candidateState.status === 'idle'
                ? <p className={css.status}>{t('memory.loading')}</p>
                : null}
              {candidateState.status === 'error' ? (
                <div className={css.failure} role="alert">
                  <p>{t('memory.error')}</p>
                  <button type="button" onClick={loadCandidates}>{t('memory.retry')}</button>
                </div>
              ) : null}
              {candidateState.status === 'ready' && candidateState.items.length === 0
                ? <p className={css.status}>{t('memory.empty')}</p>
                : null}
              {candidateState.status === 'ready' && candidateState.items.length > 0 ? (
                <ul className={css.list}>
                  {candidateState.items.map(item => (
                    <li className={css.card} key={item.id} data-memory-candidate={item.id}>
                      <div className={css.meta}>
                        <span>{readableToken(item.category ?? item.operation)}</span>
                        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                      </div>
                      <p className={css.content}>{item.candidateContent ?? t('memory.noContent')}</p>
                      <div className={css.policy}>
                        <span>{t('memory.recommendation', { value: readableToken(item.policyDecision) })}</span>
                        <span>{t('memory.confidence', { value: String(Math.round(item.confidence * 100)) })}</span>
                      </div>
                      <div className={css.actions}>
                        <button type="button" disabled={!canAccept(item) || candidateBusy !== null} onClick={() => { void decide(item, 'accept') }}>
                          {t('memory.accept')}
                        </button>
                        <button type="button" disabled={candidateBusy !== null} onClick={() => { void decide(item, 'reject') }}>
                          {t('memory.reject')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {feedback === 'stored' ? <p className={css.notice} role="status">{t('memory.feedback.stored')}</p> : null}
              {feedback === 'reviewed' ? <p className={css.notice} role="status">{t('memory.feedback.reviewed')}</p> : null}
              <p className={css.notice}>{t('memory.notice')}</p>
            </section>
          ) : (
            <section className={css.saved} aria-busy={memoryState.status === 'loading'}>
              <form className={css.filters} onSubmit={submitFilter}>
                <label className={css.srOnly} htmlFor="memory-search">{t('memory.saved.search')}</label>
                <input id="memory-search" value={queryDraft} onChange={(event) => { setQueryDraft(event.currentTarget.value) }} placeholder={t('memory.saved.search')} />
                <label className={css.srOnly} htmlFor="memory-status">{t('memory.saved.filter')}</label>
                <select
                  id="memory-status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.currentTarget.value as StatusFilter)
                    loadSaved()
                  }}
                >
                  <option value="active">{t('memory.status.active')}</option>
                  <option value="scheduled">{t('memory.status.scheduled')}</option>
                  <option value="expired">{t('memory.status.expired')}</option>
                  <option value="superseded">{t('memory.status.superseded')}</option>
                  <option value="all">{t('memory.status.all')}</option>
                </select>
                <button type="submit">{t('memory.saved.filter')}</button>
              </form>
              {memoryState.status === 'loading' || memoryState.status === 'idle'
                ? <p className={css.status}>{t('memory.saved.loading')}</p>
                : null}
              {memoryState.status === 'error' ? (
                <div className={css.failure} role="alert">
                  <p>{t('memory.saved.error')}</p>
                  <button type="button" onClick={loadSaved}>{t('memory.retry')}</button>
                </div>
              ) : null}
              {memoryState.status === 'ready' && memoryState.readOnly
                ? <p className={css.readOnly}>{t('memory.saved.readOnly')}</p>
                : null}
              {memoryState.status === 'ready' && memoryState.items.length === 0
                ? <p className={css.status}>{t('memory.saved.empty')}</p>
                : null}
              {memoryState.status === 'ready' && memoryState.items.length > 0 ? (
                <ul className={css.list}>
                  {memoryState.items.map((item) => {
                    const key = memoryKey(item)
                    const isEditing = editing === key
                    return (
                      <li className={css.card} key={key} data-memory-record={key}>
                        <div className={css.meta}>
                          <span className={css.badge}>{t(`memory.status.${item.status}`)}</span>
                          <span>{t('memory.saved.revision', { value: String(item.revision) })}</span>
                          <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
                        </div>
                        {isEditing ? (
                          <textarea className={css.editor} value={editContent} onChange={(event) => { setEditContent(event.currentTarget.value) }} aria-label={t('memory.saved.editLabel')} rows={4} />
                        ) : (
                          <p className={css.content}>{item.content ?? t('memory.saved.redacted')}</p>
                        )}
                        <div className={css.actions}>
                          {isEditing ? (
                            <>
                              <button type="button" disabled={memoryBusy !== null || editContent.trim().length === 0 || editContent.trim() === item.content} onClick={() => { requestCorrection(item) }}>
                                {t('memory.saved.reviewCorrection')}
                              </button>
                              <button type="button" onClick={() => { setEditing(null) }}>{t('memory.cancel')}</button>
                            </>
                          ) : (
                            <>
                              <button type="button" disabled={memoryState.readOnly || item.redacted || memoryBusy !== null} onClick={() => { startCorrection(item) }}>
                                {t('memory.saved.correct')}
                              </button>
                              <button className={css.danger} type="button" disabled={memoryState.readOnly || memoryBusy !== null} onClick={() => { setConfirmation({ action: 'forget', item }) }}>
                                {t('memory.saved.forget')}
                              </button>
                            </>
                          )}
                        </div>
                        {confirmation !== null && memoryKey(confirmation.item) === key ? (
                          <div className={css.confirmation} role="alert">
                            <p>{confirmation.action === 'correct' ? t('memory.confirm.correct') : t('memory.confirm.forget')}</p>
                            <div className={css.actions}>
                              <button type="button" disabled={memoryBusy !== null} onClick={() => { void confirmMutation(confirmation) }}>{t('memory.confirm.action')}</button>
                              <button type="button" disabled={memoryBusy !== null} onClick={() => { setConfirmation(null) }}>{t('memory.cancel')}</button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {memoryFeedback === 'corrected' ? <p className={css.notice} role="status">{t('memory.feedback.corrected')}</p> : null}
              {memoryFeedback === 'forgotten' ? <p className={css.notice} role="status">{t('memory.feedback.forgotten')}</p> : null}
            </section>
          )}
        </div>
      </Modal>
    </>
  )
}

/** Locale-key assertion used only to keep component calls type-checked. */
export type MemoryReviewLocaleKey = Extract<WorkDashboardKey, `memory.${string}`>
