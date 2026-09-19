/** Browser-safe projection of explicit acceptance decisions; turn completion alone is not validation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { chatNode } from './common.ts'

/** UI states for a task with an explicit acceptance decision. */
export type ValidationPhase = 'checking' | 'correcting' | 'validated' | 'unvalidated'

/** Latest observed decision and terminal outcome for one turn. */
export interface TaskValidationState {
  turn: number
  seq: number
  attempt: number
  status: 'passed' | 'retry' | 'failed'
  ended?: 'completed' | 'other'
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Explicit task acceptance, separate from the ordinary completion footer. */
    'task-validation': TaskValidationState
  }
}

/**
 * Resolve a conservative label, never treating an intermediate pass as final success.
 * @param state Latest decision and optional turn ending.
 * @returns Display phase limited to the supplied acceptance criterion.
 */
export function taskValidationPhase(state: TaskValidationState): ValidationPhase {
  if (state.ended !== undefined) return state.ended === 'completed' && state.status === 'passed' ? 'validated' : 'unvalidated'
  return state.status === 'retry' ? 'correcting' : state.status === 'failed' ? 'unvalidated' : 'checking'
}

/**
 * Read the optional host extension without importing its Node-only implementation.
 * @param event Durable wire event, possibly from a newer host.
 * @returns Recognized decision or undefined for malformed/unrelated data.
 */
export function readTaskValidation(event: { type: string; seq: number; data: unknown }): TaskValidationState | undefined {
  if (event.type !== 'task/validation' || event.data === null || typeof event.data !== 'object') return undefined
  const data = event.data as Record<string, unknown>
  if (!Number.isSafeInteger(data.turn) || (data.turn as number) < 1
    || !Number.isSafeInteger(data.attempt) || (data.attempt as number) < 1
    || (data.status !== 'passed' && data.status !== 'retry' && data.status !== 'failed')) return undefined
  return { turn: data.turn as number, seq: event.seq, attempt: data.attempt as number, status: data.status }
}

/** One live row per accepted-task turn, retained across history reconstruction. */
export const taskValidationDefinition: ConversationNodeDefinition<TaskValidationState | null> = {
  kind: 'task-validation', target: 'chat',
  match: (event) => {
    const decision = readTaskValidation(event)
    if (decision !== undefined) return { id: String(decision.turn), role: 'update' }
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: () => null,
  update: (context, match) => {
    const decision = readTaskValidation(match.event)
    if (decision !== undefined) return decision
    if (match.event.type === 'turn/end' && context.state != null) {
      return { ...context.state, ended: match.event.data.reason.kind === 'completed' ? 'completed' : 'other' }
    }
    return context.state ?? null
  },
  buildViewNode: context => context.state == null ? null : chatNode(context, 'task-validation', context.state.seq, context.state),
}

/**
 * Register the optional acceptance row in the conversation assembler.
 * @param ctx - Plugin context owning the conversation registration.
 */
export function registerTaskValidationNode(ctx: Context): void {
  ctx.conversationEvents.register(taskValidationDefinition)
}
