/**
 * Read/write vocabulary for candidate-review operations.
 * @module @deepseek-ai/dsh-tool-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { MemoryCandidateId } from './spec.ts'
import type { MemoryCandidateRecord } from './spec.ts'

/** Brand one opaque review operation identity for stable API tracing. */
export type MemoryCandidateReviewId = Branded<'MemoryCandidateReviewId'>

/** Human review outcome stored on a persisted memory candidate row. */
export type MemoryCandidateReviewDecision = 'accept' | 'ignore' | 'reject'

/** Read request to page one workspace partition of candidate telemetry. */
export interface MemoryCandidateReviewListRequest {
  /** Workspace whose candidate telemetry should be queried. */
  readonly workspaceId: WorkspaceId
  /** Optional exact session filter (when omitted, all sessions in workspace). */
  readonly sessionId?: SessionId
  /** Filter by review status: `true` reviewed, `false` unreviewed, omitted for all. */
  readonly reviewed?: boolean
  /** Filter to one explicit review decision, used only when `reviewed` is true. */
  readonly reviewDecision?: MemoryCandidateReviewDecision
  /** Pagination start index, defaulting to `0`. */
  readonly offset?: number
  /** Maximum returned candidates per page, defaulting to `50`. */
  readonly limit?: number
}

/** One page of durable candidate rows for review. */
export interface MemoryCandidateReviewListValue {
  /** Candidate rows ordered by newest `createdAt` first. */
  readonly items: readonly MemoryCandidateRecord[]
  /** True when more rows remain after this page. */
  readonly hasMore: boolean
  /** Cursor for the next page. */
  readonly nextOffset: number
}

/** Reviewable failure when a candidate no longer exists in storage. */
export interface MemoryCandidateReviewNotFound {
  readonly code: 'memory-candidate-not-found'
  readonly workspaceId: WorkspaceId
  readonly id: MemoryCandidateId
}

/** Reviewable failure when storage has been disabled for this plugin composition. */
export interface MemoryCandidateReviewStorageUnavailable {
  readonly code: 'memory-candidate-storage-unavailable'
  readonly workspaceId: WorkspaceId
}

/** Reviewable failure when a stored candidate belongs to another workspace. */
export interface MemoryCandidateReviewWorkspaceMismatch {
  readonly code: 'memory-candidate-workspace-mismatch'
  readonly workspaceId: WorkspaceId
  readonly id: MemoryCandidateId
}

/** Failure union for mark/review mutation operations. */
export type MemoryCandidateReviewFailure =
  | MemoryCandidateReviewNotFound
  | MemoryCandidateReviewStorageUnavailable
  | MemoryCandidateReviewWorkspaceMismatch

/** Request to record a human review decision on a persisted candidate row. */
export interface MemoryCandidateReviewMarkRequest {
  /** Workspace used for ownership guard and authorization partitioning. */
  readonly workspaceId: WorkspaceId
  /** Target candidate identity stored in durable `memory_candidate` domain. */
  readonly id: MemoryCandidateId
  /** Human decision for this candidate. */
  readonly decision: MemoryCandidateReviewDecision
  /** Optional operator identity captured for audit context. */
  readonly reviewedBy?: string
}

/** Success payload returned after an accepted mark mutation. */
export interface MemoryCandidateReviewMarkValue {
  readonly row: MemoryCandidateRecord
}

/** Result wrapper for `markReviewed`. */
export type MemoryCandidateReviewMarkResult =
  | { readonly ok: true; readonly value: MemoryCandidateReviewMarkValue }
  | { readonly ok: false; readonly error: MemoryCandidateReviewFailure }

export type { MemoryCandidateId, MemoryCandidateRecord }
