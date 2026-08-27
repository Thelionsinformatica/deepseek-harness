/** Durable, content-free proof that one exact goal revision passed completion audit. */

import { createHash } from 'node:crypto'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CompletionAuditorConfig } from './quality-audit.ts'

/** Hash-bound event interval captured before the independent auditor starts. */
export interface CompletionEvidenceBaseline {
  readonly goal: { readonly id: string; readonly revision: number }
  readonly fromSeq: number
  readonly throughSeq: number
  readonly eventCount: number
  readonly digest: string
}

/** Persisted PASS receipt. No prompt, objective, todo text, finding, or command output is retained. */
export interface GoalCompletionAuditMeta {
  readonly version: 1
  readonly goal: { readonly id: string; readonly revision: number }
  readonly auditor: {
    readonly provider: string
    readonly sessionId: string
    readonly modelProvider?: string
    readonly model?: string
    readonly verdict: {
      readonly algorithm: 'sha256'
      readonly digest: string
    }
  }
  readonly evidence: {
    readonly fromSeq: number
    readonly throughSeq: number
    readonly eventCount: number
    readonly algorithm: 'sha256'
    readonly digest: string
  }
  readonly completedTodoCount: number
  readonly auditedAt: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Content-free receipt proving that an exact goal revision passed independent review. */
    'goal/completion-audit': GoalCompletionAuditMeta
  }
}

/**
 * Deterministic digest over the immutable event envelopes inspected by the auditor.
 * @param events - immutable session events included in the audit evidence interval.
 * @returns lowercase SHA-256 digest of the serialized event envelopes.
 */
export function completionEvidenceDigest(events: readonly SessionEvent[]): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}

/**
 * Content-free digest of the exact schema-validated verdict returned by the auditor.
 * @param verdict - schema-validated independent auditor verdict.
 * @returns lowercase SHA-256 digest of the serialized verdict.
 */
export function completionVerdictDigest(verdict: unknown): string {
  return createHash('sha256').update(JSON.stringify(verdict)).digest('hex')
}

/**
 * Capture the exact committed goal-era state that an auditor is about to inspect.
 * @param session - session whose immutable event log contains the goal activity.
 * @param goal - exact goal identity and revision being reviewed.
 * @returns hash-bound baseline describing the committed evidence interval.
 */
export function captureCompletionEvidence(
  session: Session,
  goal: Pick<GoalView, 'id' | 'revision'>,
): CompletionEvidenceBaseline {
  const fromSeq = session.events.findLastIndex(event => event.type === 'goal/change'
    && event.data.operation === 'create' && event.data.goal.id === goal.id)
  if (fromSeq < 0) throw new Error('completion audit cannot locate the current goal creation event')
  const throughSeq = session.seq - 1
  const events = session.events.slice(fromSeq, throughSeq + 1)
  return {
    goal: { id: goal.id, revision: goal.revision },
    fromSeq,
    throughSeq,
    eventCount: events.length,
    digest: completionEvidenceDigest(events),
  }
}

/**
 * Materialize a persisted PASS receipt after freshness has been checked.
 * @param baseline - previously captured evidence interval for the goal revision.
 * @param config - resolved independent auditor configuration.
 * @param completedTodoCount - number of completed todos covered by the audit.
 * @param auditorSessionId - session identifier of the independent auditor run.
 * @param verdictDigest - content-free digest of the validated PASS verdict.
 * @returns durable audit metadata bound to the evidence and verdict digests.
 */
export function completionAuditReceipt(
  baseline: CompletionEvidenceBaseline,
  config: CompletionAuditorConfig,
  completedTodoCount: number,
  auditorSessionId: string,
  verdictDigest: string,
): GoalCompletionAuditMeta {
  return {
    version: 1,
    goal: baseline.goal,
    auditor: {
      provider: config.provider,
      sessionId: auditorSessionId,
      ...config.modelProvider === undefined ? {} : { modelProvider: config.modelProvider },
      ...config.model === undefined ? {} : { model: config.model },
      verdict: { algorithm: 'sha256', digest: verdictDigest },
    },
    evidence: {
      fromSeq: baseline.fromSeq,
      throughSeq: baseline.throughSeq,
      eventCount: baseline.eventCount,
      algorithm: 'sha256',
      digest: baseline.digest,
    },
    completedTodoCount,
    auditedAt: Date.now(),
  }
}
