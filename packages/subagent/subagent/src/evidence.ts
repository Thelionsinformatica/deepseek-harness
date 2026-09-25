/** Host-owned, log-derived tool evidence; observation is not semantic verification. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SubagentError } from './error.ts'

/** A durable successful call/result pair from the child's current turn. */
export interface SubagentEvidenceCall {
  readonly tool: string
  readonly callId: string
  readonly callSeq: number
  readonly resultSeq: number
}

/** Separate from the actual turn outcome and never authored by the child model. */
export interface SubagentEvidence {
  readonly status: 'observed' | 'missing'
  readonly semanticVerification: 'unverified'
  readonly tools: readonly string[]
  readonly calls: readonly SubagentEvidenceCall[]
}

/** Validate the host configuration or persisted policy without silently weakening it. */
export function assertEvidenceTools(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64
    || value.some((item: unknown) => typeof item !== 'string' || item.length === 0
      || item.length > 128 || item.trim() !== item)
    || new Set(value).size !== value.length) {
    throw new SubagentError('evidenceTools must contain 1-64 unique, nonempty tool names', 'INVALID_EVIDENCE_TOOLS')
  }
}

/**
 * Inspect only the latest turn in the already-bounded activation suffix. Exact
 * source seq, id, turn and step linkage excludes inherited calls, streaming
 * chunks, prior turns, orphan results and repeated copies of one result.
 * @param events - events after the host's activation boundary, not the whole log.
 * @param tools - immutable host-owned eligible tool names, or absent to opt out.
 * @returns host assessment, never proof that the reported conclusion is correct.
 */
export function evaluateSubagentEvidence(
  events: readonly SessionEvent[],
  tools: readonly string[] | undefined,
): SubagentEvidence | undefined {
  if (tools === undefined) return undefined
  const begin = events.findLastIndex(event => event.type === 'turn/start')
  const calls: SubagentEvidenceCall[] = []
  if (begin !== -1) {
    const own = events.slice(begin)
    const turnStart = own[0]
    if (turnStart?.type !== 'turn/start') throw new Error('evidence fold lost its turn boundary')
    const eligible = new Set(tools)
    const bySeq = new Map<number, SessionEvent<'tool/call'>>()
    const ids = new Set<string>()
    const ambiguous = new Set<string>()
    const used = new Set<number>()
    for (const event of own) {
      if (event.type !== 'tool/call' || event.seq <= turnStart.seq || event.data.turn !== turnStart.data.turn) continue
      if (ids.has(event.data.callId)) ambiguous.add(event.data.callId)
      ids.add(event.data.callId)
      if (eligible.has(event.data.name)) bySeq.set(event.seq, event)
    }
    for (const event of own) {
      if (event.type !== 'tool/result' || event.data.message.content[0].isError !== false
        || event.data.error !== undefined || event.surfaceOp !== 'append'
        || event.sourceEventSeqs?.length !== 1) continue
      const source = event.sourceEventSeqs[0]
      if (source === undefined) continue
      const call = bySeq.get(source)
      if (call === undefined || used.has(source) || call.seq >= event.seq
        || ambiguous.has(call.data.callId) || call.data.callId !== event.data.message.content[0].toolCallId
        || call.data.callId !== event.data.message.source.callId
        || call.data.turn !== event.data.turn || call.data.step !== event.data.step) continue
      used.add(source)
      calls.push({ tool: call.data.name, callId: call.data.callId, callSeq: call.seq, resultSeq: event.seq })
    }
  }
  return { status: calls.length > 0 ? 'observed' : 'missing', semanticVerification: 'unverified', tools: [...tools], calls }
}

/** Safe host wording without exposing tool inputs or file contents. */
export function subagentEvidenceDiagnostic(evidence: SubagentEvidence): string {
  return evidence.status === 'missing'
    ? 'SUBAGENT_EVIDENCE_MISSING: host found no eligible successful tool call/result pair in this activation\'s current turn. This report is unverified and must not be accepted as a proven audit result.'
    : 'SUBAGENT_EVIDENCE_OBSERVED: host observed eligible successful tool execution in this activation\'s current turn. Claims remain semantically unverified; the parent must inspect the cited events and review the conclusion.'
}
