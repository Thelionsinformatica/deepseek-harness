/** Replaces owned recall snapshots in model context while preserving the append-only audit log. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Every slot this plugin owns. Workspace and personal recall share one
 * projection mechanism so a snapshot is never left stale beside its successor;
 * the sections stay distinct because their cleared markers make different
 * claims about which domain stopped being current.
 */
export type RecallSection = 'memory:recall' | 'personal-memory:core' | 'personal-memory:recall'

const PLUGIN = 'tool-memory'

const CLEARED: Readonly<Record<RecallSection, string>> = {
  'memory:recall': 'Workspace memory context cleared. Previously injected workspace-memory values are not current facts.',
  'personal-memory:core': 'Personal memory context cleared. Previously injected personal-memory values are not current facts.',
  'personal-memory:recall': 'Personal memory context cleared. Previously injected personal-memory values are not current facts.',
}

function sectionOf(message: UserMessage): RecallSection | undefined {
  if (message.source.kind !== 'plugin' || message.source.plugin !== PLUGIN
    || message.source.form !== 'snapshot') return undefined
  const section = message.source.sections[0]?.name
  return section !== undefined && section in CLEARED ? section as RecallSection : undefined
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
    source: { kind: 'plugin', plugin: PLUGIN, form: 'snapshot', sections: [{ name: section, text }] },
  })
}

function sameText(message: UserMessage, text: string): boolean {
  return message.content.length === 1 && message.content[0]?.type === 'text' && message.content[0].text === text
}

/**
 * Remove owned values before downstream compaction can absorb them into a summary.
 * Other conversation messages and the original log entries remain untouched.
 * @param session - Session whose active recall is being refreshed.
 * @param sections - Owned slots to retire; unlisted sections are never touched.
 */
export function clearRecall(session: Session, sections: readonly RecallSection[]): void {
  const owned = new Set(sections)
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    if (event?.type !== 'user/message') continue
    const section = sectionOf(event.data)
    if (section === undefined || !owned.has(section) || sameText(event.data, CLEARED[section])) continue
    session.append('user/message', recallSnapshot(section, CLEARED[section]), {
      surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq],
    })
  }
}

/**
 * Reuse one retained slot or return a new snapshot for the loop to append.
 * Duplicate legacy slots remain content-free; unrelated messages are never replaced.
 * @param session - Session receiving the refreshed projection.
 * @param section - Owned slot being refreshed.
 * @param text - Bounded current data; undefined leaves the slot cleared.
 * @returns An uncommitted message only when no slot survives in active context.
 */
export function projectRecall(
  session: Session, section: RecallSection, text: string | undefined,
): UserMessage | undefined {
  if (text === undefined) return undefined
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
    if (event?.type !== 'user/message' || sectionOf(event.data) !== section) continue
    if (!sameText(event.data, text)) {
      session.append('user/message', recallSnapshot(section, text), {
        surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq],
      })
    }
    return undefined
  }
  return recallSnapshot(section, text)
}
