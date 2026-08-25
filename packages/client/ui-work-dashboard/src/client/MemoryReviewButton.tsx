/** Session-header control and modal for workspace-isolated memory review. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconArchiveOutline20, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  MemoryCandidateReviewDecision,
  MemoryCandidateReviewItem,
  MemoryCandidateReviewListValue,
} from '@deepseek-ai/dsh-tool-memory/types'
import type { WorkDashboardKey } from './locales.ts'
import css from './MemoryReviewButton.module.css'

/** Registration-side Host Remote face for the memory review control. */
export interface MemoryReviewInjected {
  list: (sessionId: SessionId) => Promise<MemoryCandidateReviewListValue>
  review: (
    sessionId: SessionId,
    id: MemoryCandidateReviewItem['id'],
    decision: MemoryCandidateReviewDecision,
  ) => Promise<MemoryCandidateReviewItem>
}

/** Full props composed by the session-header slot renderer. */
export type MemoryReviewButtonProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'work-dashboard'>
  & InjectFace<MemoryReviewInjected>

type ViewState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly MemoryCandidateReviewItem[] }

type DecisionFeedback = 'reviewed' | 'stored' | null

/** Whether the operator may accept this row for a later storage stage. */
function canAccept(item: MemoryCandidateReviewItem): boolean {
  return item.candidateContent !== undefined
    && item.sensitivity !== 'blocked'
    && item.policyDecision !== 'block'
    && item.policyDecision !== 'reject'
}

/** Translate one policy or category token without pretending it is user copy. */
function readableToken(value: string): string {
  return value.replaceAll('-', ' ')
}

/** Session header button that opens the local candidate-review queue. */
export function MemoryReviewButton({
  sessionId, list, review, t,
}: MemoryReviewButtonProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<MemoryCandidateReviewItem['id'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'idle' })
  const [feedback, setFeedback] = useState<DecisionFeedback>(null)

  const load = useCallback((): void => {
    setState({ status: 'loading' })
    setReload(value => value + 1)
  }, [])

  useEffect(() => {
    if (!open || reload === 0) return
    let current = true
    void list(sessionId).then(
      (value) => { if (current) setState({ status: 'ready', items: value.items }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, open, reload, sessionId])

  const show = (): void => {
    setOpen(true)
    setFeedback(null)
    load()
  }

  const decide = async (
    item: MemoryCandidateReviewItem,
    decision: Extract<MemoryCandidateReviewDecision, 'accept' | 'reject'>,
  ): Promise<void> => {
    setBusy(item.id)
    try {
      const reviewed = await review(sessionId, item.id, decision)
      setFeedback(reviewed.autoWrite?.status === 'stored' ? 'stored' : 'reviewed')
      setState(previous => previous.status === 'ready'
        ? { status: 'ready', items: previous.items.filter(candidate => candidate.id !== item.id) }
        : previous)
    } catch {
      setState({ status: 'error' })
    } finally {
      setBusy(null)
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
        contentClassName={css.modalContent ?? ''}
      >
        <div className={css.body} aria-busy={state.status === 'loading'}>
          {state.status === 'loading' || state.status === 'idle'
            ? <p className={css.status}>{t('memory.loading')}</p>
            : null}
          {state.status === 'error' ? (
            <div className={css.failure} role="alert">
              <p>{t('memory.error')}</p>
              <button type="button" onClick={load}>{t('memory.retry')}</button>
            </div>
          ) : null}
          {state.status === 'ready' && state.items.length === 0
            ? <p className={css.status}>{t('memory.empty')}</p>
            : null}
          {state.status === 'ready' && state.items.length > 0 ? (
            <ul className={css.list}>
              {state.items.map(item => (
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
                    <button
                      type="button"
                      disabled={!canAccept(item) || busy !== null}
                      onClick={() => { void decide(item, 'accept') }}
                    >
                      {t('memory.accept')}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => { void decide(item, 'reject') }}
                    >
                      {t('memory.reject')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {feedback === 'stored' ? (
            <p className={css.notice} role="status">{t('memory.feedback.stored')}</p>
          ) : null}
          {feedback === 'reviewed' ? (
            <p className={css.notice} role="status">{t('memory.feedback.reviewed')}</p>
          ) : null}
          <p className={css.notice}>{t('memory.notice')}</p>
        </div>
      </Modal>
    </>
  )
}

/** Locale-key assertion used only to keep component calls type-checked. */
export type MemoryReviewLocaleKey = Extract<WorkDashboardKey, `memory.${string}`>
