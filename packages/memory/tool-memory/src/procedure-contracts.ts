/**
 * Durable procedure-learning records and host-side operation results.
 * @module @deepseek-ai/dsh-tool-memory/procedure-contracts
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Stable identity of one learned procedure lineage. */
export type ProcedureId = Branded<'ProcedureId'>

/**
 * Brand one generated procedure identifier.
 * @param id - Opaque locally generated identifier.
 * @returns The same string carrying the procedure brand.
 */
export function ProcedureId(id: string): ProcedureId {
  return id as ProcedureId
}

/** Lifecycle state of one learned procedure. */
export type ProcedureStatus = 'candidate' | 'validated' | 'rejected' | 'stale' | 'revoked'

/** Exact environment fact required before a validated procedure is reusable. */
export interface ProcedurePrecondition {
  readonly key: string
  readonly expected: string
}

/** One successful tool invocation retained as an executable procedure step. */
export interface ProcedureStep {
  readonly tool: string
  readonly arguments: JsonValue
}

/** Tool invocation that independently verifies a procedure outcome. */
export interface ProcedureVerifier {
  readonly tool: string
  readonly arguments: JsonValue
}

/** Host observation of one completed tool invocation. */
export interface ProcedureToolObservation {
  readonly sessionId: SessionId
  readonly callId: CallId
  readonly tool: string
  readonly arguments: JsonValue
  readonly succeeded: boolean
  /** SHA-256 digest of the final tool result; result content is never persisted here. */
  readonly resultDigest: string
  readonly observedAt: string
}

/** Evidence retained without tool-result content for one validation attempt. */
export interface ProcedureEvidence {
  readonly kind: 'initial-validation' | 'revalidation'
  readonly sessionId: SessionId
  readonly executionCallIds: readonly CallId[]
  readonly verificationCallId: CallId
  readonly resultDigests: readonly string[]
  readonly succeeded: boolean
  readonly recordedAt: string
}

/** Absolute validity window assigned by the host producer. */
export interface ProcedureValidity {
  readonly revalidateAfter: string
  readonly validUntil: string
}

/** Durable, workspace-isolated learned procedure. */
export interface ProcedureRecord {
  readonly id: ProcedureId
  readonly workspaceId: WorkspaceId
  readonly revision: number
  readonly title: string
  readonly trigger: string
  readonly preconditions: readonly ProcedurePrecondition[]
  readonly steps: readonly ProcedureStep[]
  readonly verifier: ProcedureVerifier
  readonly validity: ProcedureValidity
  readonly status: ProcedureStatus
  readonly evidence: readonly ProcedureEvidence[]
  readonly proposedAt: string
  readonly updatedAt: string
  readonly reviewedAt?: string
  readonly reviewedBy?: string
  readonly lastValidatedAt?: string
  readonly staleAt?: string
  readonly revokedAt?: string
  readonly schemaVersion: 1
}

/** Successful trajectory submitted by a trusted host observer. */
export interface ProcedureProposalRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly trigger: string
  readonly preconditions: readonly ProcedurePrecondition[]
  readonly executions: readonly ProcedureToolObservation[]
  readonly verification: ProcedureToolObservation
  readonly validity: ProcedureValidity
}

/** Explicit operator review of one candidate revision. */
export interface ProcedureReviewRequest {
  readonly workspaceId: WorkspaceId
  readonly id: ProcedureId
  readonly expectedRevision: number
  readonly decision: 'accept' | 'reject'
}

/** Exact workspace-scoped lookup used before a human reviews a candidate. */
export interface ProcedureInspectRequest {
  readonly workspaceId: WorkspaceId
  readonly id: ProcedureId
}

/** One environment-scoped search for reusable procedures. */
export interface ProcedureReuseRequest {
  readonly workspaceId: WorkspaceId
  readonly query: string
  readonly preconditions: Readonly<Record<string, string>>
  readonly limit?: number
}

/** Why a relevant procedure was withheld from reuse. */
export type ProcedureReuseBlockReason =
  | 'expired'
  | 'precondition-mismatch'
  | 'revalidation-required'
  | 'stale'

/** Relevant procedure that cannot currently be reused. */
export interface BlockedProcedureReuse {
  readonly id: ProcedureId
  readonly revision: number
  readonly reason: ProcedureReuseBlockReason
  /** Exact verifier required to revalidate this same-workspace procedure. */
  readonly verifier: ProcedureVerifier
}

/** Deterministic procedure lookup result for one workspace. */
export interface ProcedureReuseResult {
  readonly items: readonly ProcedureRecord[]
  readonly blocked: readonly BlockedProcedureReuse[]
}

/** Revalidation result observed after a prior procedure revision. */
export interface ProcedureRevalidationRequest {
  readonly workspaceId: WorkspaceId
  readonly id: ProcedureId
  readonly expectedRevision: number
  readonly preconditions: Readonly<Record<string, string>>
  readonly verification: ProcedureToolObservation
  /** Required after a successful check; ignored after a failed check. */
  readonly validity?: ProcedureValidity
}

/** Explicit operator revocation of one non-terminal procedure revision. */
export interface ProcedureRevokeRequest {
  readonly workspaceId: WorkspaceId
  readonly id: ProcedureId
  readonly expectedRevision: number
}

/** Stable business failure returned without exposing another workspace's record. */
export type ProcedureLearningFailure =
  | { readonly code: 'procedure-invalid-proposal'; readonly reason: string }
  | { readonly code: 'procedure-sensitive-content' }
  | { readonly code: 'procedure-not-found'; readonly id: ProcedureId }
  | { readonly code: 'procedure-revision-conflict'; readonly id: ProcedureId; readonly currentRevision: number }
  | { readonly code: 'procedure-invalid-state'; readonly id: ProcedureId; readonly status: ProcedureStatus }
  | { readonly code: 'procedure-validity-expired'; readonly id: ProcedureId }
  | { readonly code: 'procedure-precondition-mismatch'; readonly id: ProcedureId }

/** Result of one procedure-learning mutation. */
export type ProcedureLearningResult =
  | { readonly ok: true; readonly value: ProcedureRecord }
  | { readonly ok: false; readonly error: ProcedureLearningFailure }
