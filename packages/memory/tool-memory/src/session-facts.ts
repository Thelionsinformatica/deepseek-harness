/**
 * Session projections that hold the Session facts tool-memory needs, so the
 * plugin never reads Session history synchronously. Resume and fork restore
 * both projections from the log.
 */
import { createHash } from 'node:crypto'
import { z as zod } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest direct-human text and the recall snapshots tool-memory injected. */
    toolMemoryRecall: ToolMemoryRecallState
    /** Open-turn human text and a bounded window of recent tool calls for procedure learning. */
    toolMemoryProcedureEvidence: ProcedureEvidenceState
  }
}

/** Producer kind stamped on every recall snapshot this package injects. */
export const RECALL_SOURCE_KIND = 'tool-memory'

/** Most recent recall snapshots retained; older ones have been replaced or compacted away. */
export const MAX_RECALL_SLOTS = 32
/** Most recent tool calls retained as procedure evidence. */
export const MAX_EVIDENCE_CALLS = 128
/** Largest raw argument string retained for one evidence call, in UTF-16 code units. */
export const MAX_EVIDENCE_ARGUMENT_CHARS = 65_536

const recallSlotSchema = zod.object({
  seq: zod.number(),
  section: zod.string(),
  text: zod.string(),
})

const toolMemoryRecallStateSchema = zod.object({
  latestHumanText: zod.string().nullable(),
  slots: zod.array(recallSlotSchema),
})

/** One recall snapshot appended by this package, at its log position. */
export type RecallSlot = zod.infer<typeof recallSlotSchema>
/** Folded recall facts. */
export type ToolMemoryRecallState = zod.infer<typeof toolMemoryRecallStateSchema>

const evidenceCallSchema = zod.object({
  callId: zod.string(),
  name: zod.string(),
  turn: zod.number(),
  step: zod.number(),
  seq: zod.number(),
  /** Raw model arguments; null when larger than {@link MAX_EVIDENCE_ARGUMENT_CHARS}. */
  arguments: zod.string().nullable(),
  /** More than one `tool/call` carried this call id. */
  ambiguous: zod.boolean(),
  result: zod.object({ isError: zod.boolean(), digest: zod.string(), time: zod.number() }).nullable(),
  /** More than one matching `tool/result` arrived. */
  resultAmbiguous: zod.boolean(),
})

const procedureEvidenceStateSchema = zod.object({
  turnOpen: zod.boolean(),
  /** Latest direct-human text of the open turn; null outside a turn. */
  openTurnHumanText: zod.string().nullable(),
  calls: zod.array(evidenceCallSchema),
})

/** One recent tool call and its final result, without result content. */
export type EvidenceCall = zod.infer<typeof evidenceCallSchema>
/** Folded procedure-learning facts. */
export type ProcedureEvidenceState = zod.infer<typeof procedureEvidenceStateSchema>

/**
 * Join the text blocks of one user-role message.
 * @param message - user-role message whose text blocks are joined.
 * @returns the text blocks separated by newlines.
 */
export function userText(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content
    .filter((block): block is { readonly type: 'text'; readonly text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Drop slots that a positional replacement removed from the surface. */
function withoutReplaced(slots: readonly RecallSlot[], event: SessionEvent): readonly RecallSlot[] {
  const op = 'surfaceOp' in event ? event.surfaceOp : undefined
  if (op === undefined || op === 'append') return slots
  return slots.filter(slot => slot.seq < op.startSeq || slot.seq > op.endSeq)
}

/**
 * Source kinds this package's snapshots carry. Session format migration lifts
 * Leon logs written before 0.2.1 (`{ kind: 'plugin', plugin: 'tool-memory' }`)
 * to the runtime-only kind `plugin:tool-memory`, so resumed legacy Sessions
 * still retire their own snapshots.
 */
const OWNED_SOURCE_KINDS: ReadonlySet<string> = new Set([RECALL_SOURCE_KIND, `plugin:${RECALL_SOURCE_KIND}`])

/** The snapshot fields of a source this package owns, or undefined for any other source. */
function ownedSnapshot(source: { readonly kind: string }): { readonly sections: readonly { readonly name: string }[] } | undefined {
  if (!OWNED_SOURCE_KINDS.has(source.kind)) return undefined
  const fields = source as { readonly form?: unknown; readonly sections?: unknown }
  return fields.form === 'snapshot' && Array.isArray(fields.sections)
    ? { sections: fields.sections as readonly { readonly name: string }[] }
    : undefined
}

/** Fold for {@link toolMemoryRecallDefinition}; returns the same reference for unrelated events. */
function applyRecall(state: ToolMemoryRecallState, event: SessionEvent): ToolMemoryRecallState {
  if (event.type !== 'user/message') return state
  const remaining = withoutReplaced(state.slots, event)
  const source = event.data.source
  if (source.kind === 'user') {
    return { latestHumanText: userText(event.data), slots: [...remaining] }
  }
  const snapshot = ownedSnapshot(source)
  if (snapshot !== undefined) {
    const section = snapshot.sections[0]?.name
    if (section === undefined) return remaining === state.slots ? state : { ...state, slots: [...remaining] }
    const slots = [...remaining, { seq: event.seq, section, text: userText(event.data) }]
    return { ...state, slots: slots.slice(-MAX_RECALL_SLOTS) }
  }
  return remaining === state.slots ? state : { ...state, slots: [...remaining] }
}

/** Projection of the latest direct-human text and this package's recall snapshots. */
export const toolMemoryRecallDefinition = {
  key: 'toolMemoryRecall',
  stateVersion: 1,
  stateSchema: toolMemoryRecallStateSchema,
  init: () => ({ latestHumanText: null, slots: [] }),
  apply: applyRecall,
} satisfies ProjectionDefinition<'toolMemoryRecall', ToolMemoryRecallState>

/** Fold for {@link procedureEvidenceDefinition}; returns the same reference for unrelated events. */
function applyEvidence(state: ProcedureEvidenceState, event: SessionEvent): ProcedureEvidenceState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, turnOpen: true, openTurnHumanText: null }
    case 'turn/end':
      return { ...state, turnOpen: false, openTurnHumanText: null }
    case 'user/message':
      return state.turnOpen && event.data.source.kind === 'user'
        ? { ...state, openTurnHumanText: userText(event.data) }
        : state
    case 'tool/call': {
      const callId = String(event.data.callId)
      if (state.calls.some(call => call.callId === callId)) {
        return { ...state, calls: state.calls.map(call => call.callId === callId ? { ...call, ambiguous: true } : call) }
      }
      const raw = event.data.arguments
      const call: EvidenceCall = {
        callId,
        name: event.data.name,
        turn: event.data.turn,
        step: event.data.step,
        seq: event.seq,
        arguments: raw.length > MAX_EVIDENCE_ARGUMENT_CHARS ? null : raw,
        ambiguous: false,
        result: null,
        resultAmbiguous: false,
      }
      return { ...state, calls: [...state.calls, call].slice(-MAX_EVIDENCE_CALLS) }
    }
    case 'tool/result': {
      const callId = String(event.data.message.toolCallId)
      const index = state.calls.findIndex(call => call.callId === callId
        && event.seq > call.seq && event.data.turn === call.turn && event.data.step === call.step)
      const current = state.calls[index]
      if (current === undefined) return state
      const next: EvidenceCall = current.result !== null
        ? { ...current, resultAmbiguous: true }
        : {
          ...current,
          result: {
            isError: event.data.message.isError === true,
            digest: createHash('sha256').update(JSON.stringify(event.data.message)).digest('hex'),
            time: event.time,
          },
        }
      return { ...state, calls: state.calls.map((call, i) => i === index ? next : call) }
    }
    default:
      return state
  }
}

/** Projection of procedure-review authority text and recent tool-call evidence. */
export const procedureEvidenceDefinition = {
  key: 'toolMemoryProcedureEvidence',
  stateVersion: 1,
  stateSchema: procedureEvidenceStateSchema,
  init: () => ({ turnOpen: false, openTurnHumanText: null, calls: [] }),
  apply: applyEvidence,
} satisfies ProjectionDefinition<'toolMemoryProcedureEvidence', ProcedureEvidenceState>
