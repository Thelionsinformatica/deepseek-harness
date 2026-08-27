/**
 * Archived-conversation management dialog. The component owns only transient
 * interaction state; session data and every mutation arrive through props.
 */
import { useMemo, useState } from 'react'
import {
  Button, IconRefreshOutline16, IconTrashOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import { DeleteConfirmationFooter } from './DeleteConfirmationFooter.tsx'
import css from './ArchivedSessionsDialog.module.css'

interface ArchivedSessionRow {
  id: SessionId
  title: string
  workspace: string
  updatedAt: number
}

interface ArchivedSessionsDialogProps {
  useSessions: WorkspaceBrowserProps['useSessions']
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionId[]
  unarchiveSession: WorkspaceBrowserProps['unarchiveSession']
  deleteSession: WorkspaceBrowserProps['deleteSession']
  onClose: () => void
  t: WorkspaceBrowserProps['t']
}

/** Convert a rejected callback value into operator-visible text. */
function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Render archived conversations with reversible restore and confirmed
 * permanent deletion.
 * @param props - live session hook, archive set, injected actions, and locale.
 * @returns the controlled dialog.
 */
export function ArchivedSessionsDialog({
  useSessions, workspaces, archivedSessionIds, unarchiveSession, deleteSession, onClose, t,
}: ArchivedSessionsDialogProps) {
  const sessions = useSessions(state => state)
  const rows = useMemo<readonly ArchivedSessionRow[]>(() => {
    const workspaceBySession = new Map<SessionId, string>()
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) {
        workspaceBySession.set(sessionId, workspace.title)
      }
    }
    return archivedSessionIds.map((id) => {
      const summary = sessions.byId[id]
      return {
        id,
        title: summary === undefined
          ? t('archived.unavailable')
          : summary.blank ? t('session.new') : summary.displayTitle,
        workspace: workspaceBySession.get(id) ?? t('group.ungrouped'),
        updatedAt: summary?.updatedAt ?? Number.NEGATIVE_INFINITY,
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt)
  }, [archivedSessionIds, sessions, t, workspaces])

  const [restoringId, setRestoringId] = useState<SessionId | null>(null)
  const [restoreError, setRestoreError] = useState<{ id: SessionId; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ArchivedSessionRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const restore = (row: ArchivedSessionRow): void => {
    /* v8 ignore next -- every restore/delete control is disabled while a restore is pending. */
    if (restoringId !== null) return
    setRestoringId(row.id)
    setRestoreError(null)
    unarchiveSession(row.id).then(() => {
      setRestoringId(null)
    }).catch((reason: unknown) => {
      setRestoringId(null)
      setRestoreError({ id: row.id, message: rejectionMessage(reason) })
    })
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = (): void => {
    /* v8 ignore next -- the confirmation button is absent without a target and disabled while deleting. */
    if (deleteTarget === null || deleting) return
    setDeleting(true)
    setDeleteError(null)
    deleteSession(deleteTarget.id).then(() => {
      setDeleting(false)
      setDeleteTarget(null)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(rejectionMessage(reason))
    })
  }

  if (deleteTarget !== null) {
    return (
      <Modal
        open
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.session.title')}
        description={t('delete.session.description', { name: deleteTarget.title })}
        footer={<DeleteConfirmationFooter
          busy={deleting}
          cancelLabel={t('cancel')}
          confirmLabel={t('archived.delete')}
          actionClassName={css.deleteAction}
          onCancel={closeDelete}
          onConfirm={confirmDelete}
        />}
      >
        {deleting && <div className={css.status} role="status">{t('delete.session.pending')}</div>}
        {deleteError !== null && <div className={css.error} role="alert">{deleteError}</div>}
      </Modal>
    )
  }

  const restoring = restoringId !== null
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('archived.title')}
      description={t('archived.description')}
      className={css.dialog ?? ''}
      footer={<Button variant="outline" onClick={onClose}>{t('close')}</Button>}
    >
      {rows.length === 0
        ? <div className={css.empty}>{t('archived.empty')}</div>
        : (
          <ul className={css.list}>
            {rows.map(row => (
              <li className={css.row} key={row.id}>
                <div className={css.sessionText}>
                  <span className={css.sessionTitle}>{row.title}</span>
                  <span className={css.sessionWorkspace}>{row.workspace}</span>
                  {restoreError?.id === row.id && (
                    <span className={css.error} role="alert">{restoreError.message}</span>
                  )}
                </div>
                <div className={css.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<IconRefreshOutline16 size={14} />}
                    aria-label={t('archived.restore.aria', { name: row.title })}
                    disabled={restoring}
                    onClick={() => { restore(row) }}
                  >
                    {restoringId === row.id ? t('archived.restoring') : t('archived.restore')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<IconTrashOutline16 size={14} />}
                    className={css.deleteAction}
                    aria-label={t('archived.delete.aria', { name: row.title })}
                    disabled={restoring}
                    onClick={() => {
                      setDeleteTarget(row)
                      setDeleteError(null)
                    }}
                  >
                    {t('archived.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  )
}
