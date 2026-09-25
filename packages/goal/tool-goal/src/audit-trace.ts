/** Bounded parent-session execution evidence for an isolated completion reviewer. */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { completionEvidenceDigest } from './completion-evidence.ts'

/**
 * Render committed calls and results without streaming chunks or model reasoning.
 * @param session - exact parent session, never a workspace-wide search.
 * @param maximum - maximum serialized trace characters.
 * @returns JSON evidence, or an explicit incomplete marker when it cannot fit.
 */
export function auditExecutionTrace(session: Session, maximum: number): string {
  const events = session.events.filter(event => event.type === 'tool/call' || event.type === 'tool/result')
  const trace = JSON.stringify({
    scope: 'parent-session-only', sessionId: session.id,
    throughSeq: session.seq - 1, complete: true,
    eventCount: events.length, digest: completionEvidenceDigest(events), events,
  })
  if (trace.length <= maximum) return trace
  // Never cut a call/result or label a partial tail as a complete execution history.
  const incomplete = JSON.stringify({ complete: false, reason: 'trace-exceeds-character-limit', eventCount: events.length })
  return incomplete.length <= maximum ? incomplete : ''
}

/**
 * Capture direct child execution from the host's lineage, not model-supplied paths.
 * @param ctx - runtime with optional persistence and live sessions.
 * @param session - exact parent being audited.
 * @param signal - cancellation for storage reads.
 * @returns a self-contained parent and direct-child evidence bundle.
 */
export async function auditTeamTrace(ctx: Context, session: Session, signal: AbortSignal): Promise<string> {
  const persistence = ctx.get('sessionPersistence')
  const live = ctx.get('sessions')
  const headers = new Map((await persistence?.list(signal) ?? []).map(header => [header.id, header]))
  for (const child of live?.list() ?? []) headers.set(child.id, child.header)
  const auditors = new Set(session.events.flatMap(event => event.type === 'goal/completion-audit'
    ? [event.data.auditor.sessionId] : []))
  const children = []
  for (const header of headers.values()) {
    if (header.parentSession !== session.id || auditors.has(header.id)) continue
    signal.throwIfAborted()
    const active = live?.get(header.id)
    const inspected = active === undefined ? await persistence?.inspect(header.id, signal) : undefined
    const events = active?.events ?? inspected?.events
    if (events === undefined || (active?.header ?? inspected?.meta)?.parentSession !== session.id) {
      throw new HarnessError('child execution evidence is unavailable', 'GOAL_QUALITY_AUDIT_EVIDENCE_INCOMPLETE')
    }
    const selected = events.filter(event => event.seq >= (header.seedLength ?? 0))
      .flatMap((event): unknown[] => {
        if (event.type === 'assistant/message') return [{ seq: event.seq, type: event.type,
          source: event.data.message.source, usage: event.data.usage,
          content: event.data.message.content.filter(block => block.type === 'text') }]
        return evidenceEvent(event) ? [event] : []
      })
    children.push({ sessionId: header.id, parentSession: session.id,
      complete: true, digest: completionEvidenceDigest(events), events: selected })
  }
  return JSON.stringify({ scope: 'parent-and-direct-children', complete: true,
    childCoverage: persistence === undefined ? 'live-only' : 'live-and-persisted',
    parent: JSON.parse(auditExecutionTrace(session, Number.MAX_SAFE_INTEGER)) as unknown, children })
}

/** Durable execution facts excluding streamed duplicates and hidden reasoning. */
function evidenceEvent(event: SessionEvent): boolean {
  return event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end'
}
