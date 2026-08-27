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

/** Unique content-free audit identity for one administrative memory mutation. */
export type MemoryAdminActionId = Branded<'MemoryAdminActionId'>

/**
 * Brand one locally generated administrative audit identity.
 * @param id - Raw locally generated audit identifier.
 * @returns The same string carrying the administrative-audit brand.
 */
export function MemoryAdminActionId(id: string): MemoryAdminActionId {
  return id as MemoryAdminActionId
}

/** Browser-safe identity compatible with the provider-owned memory id brand. */
export type MemoryAdminId = Branded<'MemoryId'>

/** Browser-side lifecycle state copied from the provider-neutral administrative projection. */
export type MemoryAdminStatus = 'active' | 'scheduled' | 'expired' | 'superseded'

/** Browser-side confirmation class copied from one durable memory. */
export type MemoryAdminValidation = 'explicit' | 'reviewed'

/** Candidate events used by memory extraction telemetry and shadow persistence. */
export type MemoryCandidateOperation = 'message_candidate' | 'memory_recall' | 'tool_call_memory_search'

/** Stable classification of a reviewable memory candidate. */
export type MemoryCandidateCategory = 'preference' | 'decision' | 'configuration' | 'procedure' | 'fact'

/** Local shadow sensitivity outcome; blocked candidates never retain content. */
export type MemoryCandidateSensitivity = 'none' | 'review' | 'blocked'

/** Human review decision captured on a candidate row from operator flow. */
export type MemoryCandidateReviewDecision = 'accept' | 'ignore' | 'reject'

/** Durable outcome of the controlled write that may follow human acceptance. */
export type MemoryCandidateAutoWriteStatus = 'skipped' | 'writing' | 'stored' | 'failed'

/** Stable reason behind one controlled automatic-write outcome. */
export type MemoryCandidateAutoWriteReason =
  | 'feature-disabled'
  | 'workspace-not-enabled'
  | 'user-not-enabled'
  | 'policy-not-eligible'
  | 'human-ignored'
  | 'human-rejected'
  | 'write-started'
  | 'approved-and-authorized'
  | 'provider-failed'

/** Append-only decision trace projected from the candidate review journal. */
export interface MemoryCandidateAutoWriteTrace {
  readonly status: MemoryCandidateAutoWriteStatus
  readonly reason: MemoryCandidateAutoWriteReason
  readonly recordedAt: string
  /** Opaque provider-returned id; the browser cannot use it as a write authority. */
  readonly memoryId?: string
  readonly revision?: number
}

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
  readonly autoWrite?: MemoryCandidateAutoWriteTrace
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

/** The approved write failed and the candidate remains retryable and unreviewed. */
export interface MemoryCandidateAutoWriteFailed {
  readonly code: 'memory-candidate-auto-write-failed'
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
  | MemoryCandidateAutoWriteFailed

/** Request to record one human review decision. */
export interface MemoryCandidateReviewMarkRequest {
  /** Session whose workspace authorizes the mutation. */
  readonly sessionId: SessionId
  /** Target candidate identity. */
  readonly id: MemoryCandidateId
  /** Human decision; acceptance writes only when all controlled feature flags authorize it. */
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

/** Browser-safe projection of one durable memory revision. */
export interface MemoryAdminItem {
  readonly id: MemoryAdminId
  readonly revision: number
  /** Omitted when a legacy credential signature requires local redaction. */
  readonly content?: string
  readonly redacted: boolean
  readonly status: MemoryAdminStatus
  readonly sourceSessionId: SessionId
  readonly importance?: number
  readonly confidence?: number
  readonly validation?: MemoryAdminValidation
  readonly validFrom?: string
  readonly validUntil?: string
  readonly expiresAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** List one authorized workspace memory partition with bounded filters. */
export interface MemoryAdminListRequest {
  readonly sessionId: SessionId
  readonly query?: string
  readonly statuses?: readonly MemoryAdminStatus[]
  readonly offset?: number
  readonly limit?: number
}

/** One page of administrative memory rows. */
export interface MemoryAdminListValue {
  readonly items: readonly MemoryAdminItem[]
  readonly hasMore: boolean
  readonly nextOffset: number
  readonly readOnly: boolean
}

/** Mutation is disabled by the deployment rollback switch. */
export interface MemoryAdminReadOnly {
  readonly code: 'memory-admin-read-only'
}

/** A destructive or corrective action lacked explicit operator confirmation. */
export interface MemoryAdminConfirmationRequired {
  readonly code: 'memory-admin-confirmation-required'
}

/** Corrected text matched a credential signature and was rejected before persistence. */
export interface MemoryAdminSensitiveContent {
  readonly code: 'memory-admin-sensitive-content'
}

/** The provider rejected or could not complete an administrative operation. */
export interface MemoryAdminOperationFailed {
  readonly code: 'memory-admin-operation-failed'
  readonly action: 'list' | 'remember' | 'correct' | 'forget' | 'toggle'
  readonly auditId?: MemoryAdminActionId
}

/** Personal-memory administration was not composed for this deployment. */
export interface PersonalMemoryAdminUnavailable {
  readonly code: 'memory-admin-personal-unavailable'
}

/** Failure union for administrative memory operations. */
export type MemoryAdminFailure =
  | MemoryCandidateReviewSessionNotFound
  | MemoryCandidateReviewWorkspaceUnavailable
  | MemoryAdminReadOnly
  | MemoryAdminConfirmationRequired
  | MemoryAdminSensitiveContent
  | MemoryAdminOperationFailed
  | PersonalMemoryAdminUnavailable

/** Administrative list result. */
export type MemoryAdminListResult =
  | { readonly ok: true; readonly value: MemoryAdminListValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }

/** Request to correct one exact memory revision. */
export interface MemoryAdminCorrectRequest {
  readonly sessionId: SessionId
  readonly id: MemoryAdminId
  readonly revision: number
  readonly content: string
  readonly confirmed: boolean
}

/** Request to forget one exact memory lineage. */
export interface MemoryAdminForgetRequest {
  readonly sessionId: SessionId
  readonly id: MemoryAdminId
  readonly revision: number
  readonly confirmed: boolean
}

/** Successful administrative correction response. */
export interface MemoryAdminCorrectValue {
  readonly item: MemoryAdminItem
  readonly auditId: MemoryAdminActionId
}

/** Successful administrative forget response. */
export interface MemoryAdminForgetValue {
  readonly id: MemoryAdminId
  readonly revision: number
  readonly auditId: MemoryAdminActionId
}

/** Administrative correction result. */
export type MemoryAdminCorrectResult =
  | { readonly ok: true; readonly value: MemoryAdminCorrectValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }

/** Administrative forgetting result. */
export type MemoryAdminForgetResult =
  | { readonly ok: true; readonly value: MemoryAdminForgetValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }

/** One page of owner-isolated personal memories. */
export interface PersonalMemoryAdminListValue extends MemoryAdminListValue {
  /** Whether Leon may recall or add personal memories. Listing and forgetting remain available. */
  readonly enabled: boolean
}

/** Personal-memory list result. */
export type PersonalMemoryAdminListResult =
  | { readonly ok: true; readonly value: PersonalMemoryAdminListValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }

/** Request to add one explicit personal fact. */
export interface PersonalMemoryAdminRememberRequest {
  readonly sessionId: SessionId
  readonly content: string
  readonly confirmed: boolean
}

/** Successful personal-memory creation response. */
export interface PersonalMemoryAdminRememberValue {
  readonly item: MemoryAdminItem
  readonly auditId: MemoryAdminActionId
}

/** Personal-memory creation result. */
export type PersonalMemoryAdminRememberResult =
  | { readonly ok: true; readonly value: PersonalMemoryAdminRememberValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }

/** Request to enable or disable personal recall and storage. */
export interface PersonalMemoryAdminToggleRequest {
  readonly sessionId: SessionId
  readonly enabled: boolean
  readonly confirmed: boolean
}

/** Successful personal-memory preference mutation. */
export interface PersonalMemoryAdminToggleValue {
  readonly enabled: boolean
  readonly auditId: MemoryAdminActionId
}

/** Personal-memory enablement result. */
export type PersonalMemoryAdminToggleResult =
  | { readonly ok: true; readonly value: PersonalMemoryAdminToggleValue }
  | { readonly ok: false; readonly error: MemoryAdminFailure }
