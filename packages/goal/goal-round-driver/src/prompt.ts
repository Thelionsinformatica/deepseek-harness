/** Model-visible continuation prompt for one same-session goal round. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderGoalRoundPrompt(goal: GoalView, round: number): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + 'Continue working toward the objective in this same session. Before any write or edit, reconcile '
      + 'the current state: read the durable task list, inspect the relevant workspace artifacts, and check '
      + 'the latest failed or missing verification. Treat that evidence as authoritative, not earlier narration. '
      + 'Do not recreate, replace, or expand work that already exists unless inspection proves it is missing or '
      + 'broken. Preserve the existing todo plan and update item statuses with todo_write; do not replace the '
      + 'whole plan merely because a new round started. Work from the first unfinished item. Make concrete '
      + 'progress and verify the result. A syntax check is not runtime evidence, and a command succeeds only '
      + 'when its actual tool result confirms success. After the final code change, rerun every requested test, '
      + 'start, or health check before claiming completion. For local servers, make one managed background '
      + 'call containing only the server start command. Run its HTTP health check in a '
      + 'separate foreground call, then stop only that returned job. Never place the health check after the '
      + 'server start in the same command. If the HTTP check fails or the connection is refused, read the '
      + 'returned server job output before changing ports; its stderr is the primary runtime evidence. Never '
      + 'free a port by terminating its existing owner; choose another port or report the conflict. Then read '
      + 'the current goal, ensure every task is '
      + 'completed, and mark it complete. If work remains, leave the goal active for the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
