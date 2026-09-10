import type { ChatNodeViewProps } from '../contract/slots.ts'
import { taskValidationPhase } from '../conversation-nodes/task-validation.ts'
import css from './MessageItem.module.css'

/** Status applies only to explicit acceptance criteria, not to the entire conversation. */
export function TaskValidationView({ node, t }: ChatNodeViewProps<'task-validation'>) {
  const phase = taskValidationPhase(node.data)
  return <div className={css.contextRow} role="status" aria-live="polite" data-validation-phase={phase}>
    {t(`validation.${phase}`)} · {t('validation.attempt', { attempt: node.data.attempt })}
  </div>
}
