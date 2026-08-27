import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'

interface DeleteConfirmationFooterProps {
  busy: boolean
  cancelLabel: ReactNode
  confirmLabel: ReactNode
  actionClassName: string | undefined
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Render the shared footer for a confirmed permanent-deletion dialog.
 * @param props - labels, busy state, styling, and dialog callbacks.
 * @returns the two dialog action buttons.
 */
export function DeleteConfirmationFooter({
  busy, cancelLabel, confirmLabel, actionClassName, onCancel, onConfirm,
}: DeleteConfirmationFooterProps) {
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
      <Button
        variant="outline"
        className={actionClassName}
        disabled={busy}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </>
  )
}
