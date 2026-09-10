/** Compact explicit Web-access control in the conversation composer. */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WebAccessControlInjected } from './index.ts'
import css from './WebAccessControl.module.css'

/** Full props for the session-scoped right-side composer control. */
export type WebAccessControlProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<WebAccessControlInjected>
  & PropsLocale<'web-access'>

/** Local globe glyph; no general browser capability is implied by this control. */
function WebGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="9" r="6.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.45 9h13.1M9 2.3c1.7 1.85 2.55 4.08 2.55 6.7S10.7 13.85 9 15.7C7.3 13.85 6.45 11.62 6.45 9S7.3 4.15 9 2.3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render a state-derived access toggle. The host projection, rather than an
 * optimistic local copy, remains the authoritative indication of access.
 */
export function WebAccessControl({ session, useProjection, toggleWebAccess, t }: WebAccessControlProps) {
  const access = useProjection('webAccess')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // The host update can arrive before the RPC settles (or from another surface).
  useEffect(() => { setPending(false) }, [access?.enabled])

  if (access === undefined || session.removed) return null
  const enabled = access.enabled
  const title = pending ? t('pending') : t(enabled ? 'on.title' : 'off.title')

  const toggle = (): void => {
    if (pending) return
    setPending(true)
    setFailure(null)
    void toggleWebAccess(!enabled).then((message) => {
      if (!alive.current) return
      setPending(false)
      setFailure(message)
    }, (reason: unknown) => {
      if (!alive.current) return
      setPending(false)
      setFailure(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.root} data-enabled={enabled ? 'true' : 'false'}>
      <button
        className={css.button}
        type="button"
        aria-pressed={enabled}
        aria-label={t(enabled ? 'on.aria' : 'off.aria')}
        title={title}
        disabled={pending}
        onClick={toggle}
      >
        <WebGlyph />
        <span>Web</span>
      </button>
      {failure !== null ? <span className={css.failure} role="status" title={failure}>{t('failure')}</span> : null}
    </span>
  )
}
