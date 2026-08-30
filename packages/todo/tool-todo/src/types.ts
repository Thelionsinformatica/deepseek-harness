/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/types
 */

import type { TodoItem } from '@deepseek-ai/dsh-session/types'

export type { TodoItem } from '@deepseek-ai/dsh-session/types'

/** Host-only fold state retaining whether a durable unfinished goal owns the visible plan. */
export interface TodoProjectionState {
  todos: TodoItem[] | null
  activeGoalId: string | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    todos: TodoProjectionState
  }
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write and after a later direct-human message
     * when no unfinished goal owns the plan. Human resume messages and automatic
     * continuation messages retain an unfinished goal's plan. Whole-value rule:
     * every `todo/write` carries the complete replacement list, so the fold is last-wins.
     */
    todos: TodoItem[] | null
  }
}
