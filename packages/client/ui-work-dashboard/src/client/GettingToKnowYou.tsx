/** Optional guided interview; drafts stay in component memory until individually confirmed. */
import { useRef, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MemoryReviewButton.module.css'

const topics = ['name', 'work', 'communication', 'goals', 'boundaries'] as const

/** Render a skippable interview over the existing confirmed personal-memory operation.
 * @param props - Locale, current write availability, and confirmed save operation.
 * @returns The interview and editable per-answer review.
 */
export function GettingToKnowYou({ t, disabled, save }: PropsLocale<'work-dashboard'> & {
  readonly disabled: boolean
  readonly save: (content: string) => Promise<void>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<string[]>(topics.map(() => ''))
  const [saved, setSaved] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const topic = topics[step]
  const reset = (): void => {
    setOpen(false)
    setStep(0)
    setAnswers(topics.map(() => ''))
    setSaved([])
    setFailed(false)
  }
  const change = (index: number, value: string): void => {
    setAnswers(previous => previous.map((answer, position) => position === index ? value : answer))
    setFailed(false)
  }
  const confirm = async (index: number): Promise<void> => {
    const selectedTopic = topics[index]
    const answer = answers[index]?.trim()
    if (disabled || inFlight.current || saved.includes(index) || !answer || selectedTopic === undefined) return
    inFlight.current = true
    setBusy(true)
    setFailed(false)
    try {
      // Keep the user's exact wording; no LLM inference or authorization changes.
      await save(`${t(`memory.intro.question.${selectedTopic}`)}\n${answer}`)
      setSaved(previous => [...previous, index])
    } catch {
      setFailed(true)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return <section className={css.card} aria-label={t('memory.intro.title')} aria-busy={busy}>
    <strong>{t('memory.intro.title')}</strong>
    <p className={css.notice}>{t('memory.intro.detail')}</p>
    {!open ? <div className={css.actions}>
      <button type="button" disabled={disabled} onClick={() => { setOpen(true) }}>{t('memory.intro.start')}</button>
    </div> : <>
      <p className={css.notice}>{t('memory.intro.privacy')}</p>
      {topic !== undefined ? <>
        <label htmlFor="personal-interview-answer">{t(`memory.intro.question.${topic}`)}</label>
        <textarea id="personal-interview-answer" className={css.editor} rows={3} maxLength={600}
          value={answers[step]} disabled={disabled || busy}
          onChange={(event) =>{  change(step, event.currentTarget.value) }} />
        <div className={css.actions}>
          <button type="button" disabled={disabled || busy || !answers[step]?.trim()} onClick={() => { setStep(step + 1) }}>{t('memory.intro.next')}</button>
          <button type="button" disabled={busy} onClick={() => { change(step, ''); setStep(step + 1) }}>{t('memory.intro.skip')}</button>
        </div>
      </> : <>
        <strong>{t('memory.intro.review')}</strong>
        {answers.every(answer => !answer.trim()) ? <p className={css.notice}>{t('memory.intro.empty')}</p> : null}
        {topics.map((item, index) => !answers[index]?.trim() ? null : <div className={css.card} key={item}>
          <label htmlFor={`personal-review-${item}`}>{t(`memory.intro.question.${item}`)}</label>
          <textarea id={`personal-review-${item}`} className={css.editor} rows={2} maxLength={600}
            value={answers[index]} disabled={disabled || busy || saved.includes(index)}
            onChange={(event) =>{  change(index, event.currentTarget.value) }} />
          {saved.includes(index) ? <p role="status">{t('memory.intro.saved')}</p> : <div className={css.actions}>
            <button type="button" disabled={disabled || busy} onClick={() => { void confirm(index) }}>{t('memory.intro.save')}</button>
            <button type="button" disabled={busy} onClick={() =>{  change(index, '') }}>{t('memory.intro.discard')}</button>
          </div>}
        </div>)}
      </>}
      {failed ? <p role="alert">{t('memory.intro.error')}</p> : null}
      <div className={css.actions}><button type="button" disabled={busy} onClick={reset}>{t('memory.intro.close')}</button></div>
    </>}
  </section>
}
