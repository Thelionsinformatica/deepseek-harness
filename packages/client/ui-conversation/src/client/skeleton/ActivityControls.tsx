/** Visible session controls for the activity panel and browser fullscreen. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ActivityControls.module.css'

type Props = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'conversation'> & {
  openActivity: () => void
}

/** Open real tool details or toggle the current document's fullscreen view. */
export function ActivityControls({ openActivity, t }: Props) {
  const [error, setError] = useState(false)
  const fullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
      setError(false)
    } catch { setError(true) }
  }
  return <div className={css.controls}>
    <button type="button" className={css.button} onClick={openActivity}>{t('activity.open')}</button>
    <button type="button" className={css.button} onClick={() => { void fullscreen() }}>{t('activity.fullscreen')}</button>
    {error && <span role="status">{t('activity.fullscreenHint')}</span>}
  </div>
}
