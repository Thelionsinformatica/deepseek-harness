/** Conservative reuse of a PASS within the same uninterrupted completion turn. */
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { Session } from '@deepseek-ai/dsh-session'
import type { GoalCompletionAuditMeta } from './completion-evidence.ts'

/**
 * Find a current receipt followed only by checklist/control operations.
 * @param session - owning parent log.
 * @param goal - exact goal revision still under review.
 * @returns the receipt, or undefined after work, a new turn, or changed requirements.
 */
export function reusableReview(session: Session, goal: GoalView): GoalCompletionAuditMeta | undefined {
  const receipt = session.events.findLast(event => event.type === 'goal/completion-audit')
  if (receipt?.type !== 'goal/completion-audit'
    || receipt.data.artifacts === undefined
    || receipt.data.goal.id !== goal.id || receipt.data.goal.revision !== goal.revision) return undefined
  const before = session.events.slice(0, receipt.seq).findLast(event => event.type === 'todo/write')
  const after = session.events.findLast(event => event.type === 'todo/write')
  if (before?.type !== after?.type) return undefined
  if (before?.type === 'todo/write' && after?.type === 'todo/write'
    && (before.data.todos.length !== after.data.todos.length
      || before.data.todos.some((todo, index) => todo.content !== after.data.todos[index]?.content
        || (todo.status === 'completed' && after.data.todos[index].status !== 'completed')))) return undefined
  for (const event of session.events.slice(receipt.seq + 1)) {
    if (event.type === 'turn/end' || event.type === 'turn/start' || event.type === 'goal/change') return undefined
    if (event.type === 'user/message' && event.data.source.kind !== 'plugin') return undefined
    if (event.type === 'tool/call') {
      if (event.data.name === 'get_goal' || event.data.name === 'todo_write') continue
      if (event.data.name === 'update_goal') {
        let args: unknown
        try { args = JSON.parse(event.data.arguments) } catch { return undefined }
        if (typeof args === 'object' && args !== null && 'action' in args && args.action === 'complete') continue
      }
      return undefined
    }
  }
  return receipt.data
}
