/** Replaces owned recall snapshots in model context while preserving the append-only audit log. */
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import type { RecallSlot, ToolMemoryRecallState } from './session-facts.ts'
import { RECALL_SOURCE_KIND } from './session-facts.ts'

/**
 * Every slot this plugin owns. Workspace and personal recall share one
 * projection mechanism so a snapshot is never left stale beside its successor;
 * the sections stay distinct because their cleared markers make different
 * claims about which domain stopped being current.
 */
export type RecallSection = 'memory:recall' | 'personal-memory:core' | 'personal-memory:recall'

const CLEARED: Readonly<Record<RecallSection, string>> = {
  'memory:recall': 'Workspace memory context cleared. Previously injected workspace-memory values are not current facts.',
  'personal-memory:core': 'Personal memory context cleared. Previously injected personal-memory values are not current facts.',
  'personal-memory:recall': 'Personal memory context cleared. Previously injected personal-memory values are not current facts.',
}

/** Narrow a recorded section name to an owned slot. */
function ownedSection(name: string): RecallSection | undefined {
  return name in CLEARED ? name as RecallSection : undefined
}

/**
 * Build one owned snapshot message. Callers that must keep the value adjacent
 * to the current human message prepend this instead of reusing a slot.
 * @param section - Owned slot the message belongs to.
 * @param text - Bounded current data.
 * @returns An uncommitted plugin snapshot message.
 */
export function recallSnapshot(section: RecallSection, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: RECALL_SOURCE_KIND, form: 'snapshot', sections: [{ name: section, text }] },
  })
}

/** Owned slots still present in active context, in surface order. */
function liveSlots(session: Session, state: ToolMemoryRecallState | undefined): RecallSlot[] {
  if (state === undefined) return []
  const position = new Map<number, number>(session.surface.nodes.map((seq, index) => [seq, index]))
  return state.slots
    .filter(slot => position.has(slot.seq))
    .sort((a, b) => (position.get(a.seq) ?? 0) - (position.get(b.seq) ?? 0))
}

/** Replace one surface slot in place, citing the replaced snapshot. */
function replaceSlot(session: Session, slot: RecallSlot, section: RecallSection, text: string): void {
  const seq = SessionSeq(slot.seq)
  session.append('user/message', recallSnapshot(section, text), {
    surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
  })
}

/**
 * Remove owned values before downstream compaction can absorb them into a summary.
 * Other conversation messages and the original log entries remain untouched.
 * @param session - Session whose active recall is being refreshed.
 * @param state - The Session's `toolMemoryRecall` projection state.
 * @param sections - Owned slots to retire; unlisted sections are never touched.
 */
export function clearRecall(session: Session, state: ToolMemoryRecallState | undefined, sections: readonly RecallSection[]): void {
  const owned = new Set(sections)
  for (const slot of liveSlots(session, state)) {
    const section = ownedSection(slot.section)
    if (section === undefined || !owned.has(section) || slot.text === CLEARED[section]) continue
    replaceSlot(session, slot, section, CLEARED[section])
  }
}

/**
 * Reuse one retained slot or return a new snapshot for the loop to append.
 * Duplicate legacy slots remain content-free; unrelated messages are never replaced.
 * @param session - Session receiving the refreshed projection.
 * @param state - The Session's `toolMemoryRecall` projection state.
 * @param section - Owned slot being refreshed.
 * @param text - Bounded current data; undefined leaves the slot cleared.
 * @returns An uncommitted message only when no slot survives in active context.
 */
export function projectRecall(
  session: Session, state: ToolMemoryRecallState | undefined, section: RecallSection, text: string | undefined,
): UserMessage | undefined {
  if (text === undefined) return undefined
  const slot = liveSlots(session, state).find(candidate => candidate.section === section)
  if (slot === undefined) return recallSnapshot(section, text)
  if (slot.text !== text) replaceSlot(session, slot, section, text)
  return undefined
}
