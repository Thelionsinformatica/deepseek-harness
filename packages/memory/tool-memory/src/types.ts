/**
 * Public request, value, and failure vocabulary for local candidate review.
 * The browser receives projected items without internal workspace or owner ids.
 * @module @deepseek-ai/dsh-tool-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Unique identity for one persisted candidate snapshot. */
export type MemoryCandidateId = Branded<'MemoryCandidateId'>

/**
 * Brand one stable candidate identifier without importing Host services.
 * @param id - Raw stable candidate identifier.
 * @returns The same string carrying the memory-candidate brand.
 */
export function MemoryCandidateId(id: string): MemoryCandidateId {
  return id as MemoryCandidateId
}

/** Candidate events used by memory extraction telemetry and shadow persistence. */
export type MemoryCandidateOperation = 'message_candidate' | 'memory_recall' | 'tool_call_memory_search'

/** Stable classification of a reviewable memory candidate. */
export type MemoryCandidateCategory = 'preference' | 'decision' | 'configuration' | 'procedure' | 'fact'

/** Local shadow sensitivity outcome; blocked candidates never retain content. */
export type MemoryCandidateSensitivity = 'none' | 'review' | 'blocked'

/** Human review decision captured on a candidate row from operator flow. */
export type MemoryCandidateReviewDecision = 'accept' | 'ignore' | 'reject'

/** Stable policy version exposed to the review Client. */
export type MemoryPolicyVersion = 1

/** Deterministic policy outcomes exposed to the review Client. */
export type MemoryPolicyDecision = 'block' | 'reject' | 'shadow' | 'confirm' | 'store'

/** Stable policy reasons exposed to the review Client. */
export type MemoryPolicyReason =
  | 'candidate-extracted'
  | 'no-candidates'
  | 'all-candidates-sensitive'
  | 'low-confidence'
  | 'credential-signal'
  | 'sensitivity-review-required'
  | 'high-confidence'
  | 'moderate-confidence'

/** Review-safe projection of one durable candidate row. */
export interface MemoryCandidateReviewItem {
  readonly id: MemoryCandidateId
  readonly sessionId: SessionId
  readonly operation: MemoryCandidateOperation
  readonly candidateContent?: string
  readonly category?: MemoryCandidateCategory
  readonly confidence: number
  readonly importance?: number
  readonly sensitivity?: MemoryCandidateSensitivity
  readonly policyVersion: MemoryPolicyVersion
  readonly policyDecision: MemoryPolicyDecision
  readonly policyReason: MemoryPolicyReason
  readonly reviewed: boolean
  readonly reviewDecision?: MemoryCandidateReviewDecision
  readonly reviewedAt?: string
  readonly reviewedBy?: string
  readonly createdAt: string
}

/** Read one workspace candidate partition using a Session as the ownership anchor. */
export interface MemoryCandidateReviewListRequest {
  /** Session whose registered workspace authorizes this read. */
  readonly sessionId: SessionId
  /** Filter by review status: `true` reviewed, `false` pending, omitted for all. */
  readonly reviewed?: boolean
  /** Filter to one explicit review decision, used only when `reviewed` is true. */
  readonly reviewDecision?: MemoryCandidateReviewDecision
  /** Pagination start index, defaulting to `0`. */
  readonly offset?: number
  /** Maximum returned candidates per page, defaulting to `50`. */
  readonly limit?: number
}

/** One page of projected candidate rows ordered newest first. */
export interface MemoryCandidateReviewListValue {
  readonly items: readonly MemoryCandidateReviewItem[]
  readonly hasMore: boolean
  readonly nextOffset: number
}

/** The requested Session does not exist in the live or persisted catalog. */
export interface MemoryCandidateReviewSessionNotFound {
  readonly code: 'memory-review-session-not-found'
  readonly sessionId: SessionId
}

/** The requested Session has no registered workspace ownership boundary. */
export interface MemoryCandidateReviewWorkspaceUnavailable {
  readonly code: 'memory-review-workspace-unavailable'
  readonly sessionId: SessionId
}

/** A candidate no longer exists in the durable review queue. */
export interface MemoryCandidateReviewNotFound {
  readonly code: 'memory-candidate-not-found'
  readonly id: MemoryCandidateId
}

/** A candidate exists but belongs to a different workspace partition. */
export interface MemoryCandidateReviewWorkspaceMismatch {
  readonly code: 'memory-candidate-workspace-mismatch'
  readonly id: MemoryCandidateId
}

/** A prior human decision prevents replacing the candidate review outcome. */
export interface MemoryCandidateReviewAlreadyReviewed {
  readonly code: 'memory-candidate-already-reviewed'
  readonly current: MemoryCandidateReviewItem
}

/** A blocked or content-free telemetry row cannot be accepted for future storage. */
export interface MemoryCandidateReviewNotAcceptable {
  readonly code: 'memory-candidate-not-acceptable'
  readonly id: MemoryCandidateId
}

/** Failure union for candidate list and review operations. */
export type MemoryCandidateReviewFailure =
  | MemoryCandidateReviewSessionNotFound
  | MemoryCandidateReviewWorkspaceUnavailable
  | MemoryCandidateReviewNotFound
  | MemoryCandidateReviewWorkspaceMismatch
  | MemoryCandidateReviewAlreadyReviewed
  | MemoryCandidateReviewNotAcceptable

/** Request to record one human review decision. */
export interface MemoryCandidateReviewMarkRequest {
  /** Session whose workspace authorizes the mutation. */
  readonly sessionId: SessionId
  /** Target candidate identity. */
  readonly id: MemoryCandidateId
  /** Human decision; acceptance still does not write durable memory. */
  readonly decision: MemoryCandidateReviewDecision
}

/** Candidate list operation result. */
export type MemoryCandidateReviewListResult =
  | { readonly ok: true; readonly value: MemoryCandidateReviewListValue }
  | { readonly ok: false; readonly error: MemoryCandidateReviewFailure }

/** Successful review mutation value. */
export interface MemoryCandidateReviewMarkValue {
  readonly item: MemoryCandidateReviewItem
}

/** Result wrapper for one review mutation. */
export type MemoryCandidateReviewMarkResult =
  | { readonly ok: true; readonly value: MemoryCandidateReviewMarkValue }
  | { readonly ok: false; readonly error: MemoryCandidateReviewFailure }
