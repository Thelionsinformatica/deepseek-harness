/** Replaces personal recall in model context while preserving the append-only audit log. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

type PersonalSection = 'personal-memory:core' | 'personal-memory:recall'
const PLUGIN = 'tool-memory'
const CLEARED = 'Personal memory context cleared. Previously injected personal-memory values are not current facts.'

function sectionOf(message: UserMessage): PersonalSection | undefined {
  if (message.source.kind !== 'plugin' || message.source.plugin !== PLUGIN
    || message.source.form !== 'snapshot') return undefined
  const section = message.source.sections[0]?.name
  return section === 'personal-memory:core' || section === 'personal-memory:recall' ? section : undefined
}

function snapshot(section: PersonalSection, text: string): UserMessage {
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
 */
export function clearPersonalRecall(session: Session): void {
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    if (event?.type !== 'user/message') continue
    const section = sectionOf(event.data)
    if (section === undefined || sameText(event.data, CLEARED)) continue
    session.append('user/message', snapshot(section, CLEARED), {
      surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq],
    })
  }
}

/**
 * Reuse one retained slot or return a new snapshot for the loop to append.
 * Duplicate legacy slots remain content-free; unrelated messages are never replaced.
 * @param session - Session receiving the refreshed projection.
 * @param section - Owned core or query-recall slot.
 * @param text - Bounded current data; undefined leaves the slot cleared.
 * @returns An uncommitted message only when no slot survives in active context.
 */
export function projectPersonalRecall(
  session: Session, section: PersonalSection, text: string | undefined,
): UserMessage | undefined {
  if (text === undefined) return undefined
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
    if (event?.type !== 'user/message' || sectionOf(event.data) !== section) continue
    if (!sameText(event.data, text)) {
      session.append('user/message', snapshot(section, text), {
        surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq],
      })
    }
    return undefined
  }
  return snapshot(section, text)
}
