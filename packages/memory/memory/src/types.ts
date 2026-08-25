/**
 * Provider-neutral vocabulary for durable, workspace-scoped memory.
 * @module @deepseek-ai/dsh-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable identity of one memory, independent of its provider or content. */
export type MemoryId = Branded<'MemoryId'>

/**
 * Brand a provider-returned string as a {@link MemoryId}.
 * @param id - Raw stable memory id.
 * @returns the same string with the memory-id brand.
 */
export function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

/** The isolation boundary applied to every memory operation. */
export interface MemoryScope {
  /** Stable workspace identity; raw paths never become memory ownership keys. */
  readonly workspaceId: WorkspaceId
}

/** Provenance stamped when a session explicitly creates a memory. */
export interface MemorySource {
  readonly kind: 'session'
  readonly sessionId: SessionId
}

/** How one durable memory was confirmed before storage. */
export type MemoryValidation = 'explicit' | 'reviewed'

/** One normalized durable memory returned by any provider. */
export interface MemoryRecord {
  readonly id: MemoryId
  readonly scope: MemoryScope
  readonly content: string
  /** Compare-and-set revision; every successful correction increments it. */
  readonly revision: number
  readonly source: MemorySource
  /** Optional normalized importance retained from deterministic extraction or an explicit write. */
  readonly importance?: number
  /** Optional confidence of the source decision that produced this record. */
  readonly confidence?: number
  /** Optional confirmation class; legacy records remain valid without it. */
  readonly validation?: MemoryValidation
  /** Persistent record schema version; legacy records default to 1. */
  readonly schemaVersion?: MemoryRecordSchemaVersion
  readonly createdAt: string
  readonly updatedAt: string
}

/** Deterministic policy versioning contract for memory-write automation. */
export const MEMORY_POLICY_VERSION = 1 as const
/** Stable policy version identity. */
export type MemoryPolicyVersion = typeof MEMORY_POLICY_VERSION
/** Deterministic outcomes for policy evaluation. */
export type MemoryPolicyDecision = 'block' | 'reject' | 'shadow' | 'confirm' | 'store'
/** Stable reason set used for replay and audit. */
export type MemoryPolicyReason =
  | 'candidate-extracted'
  | 'no-candidates'
  | 'all-candidates-sensitive'
  | 'low-confidence'
  | 'credential-signal'
  | 'sensitivity-review-required'
  | 'high-confidence'
  | 'moderate-confidence'

/** Canonical policy outcome for candidate-driven automation flows. */
export interface MemoryPolicyRecord {
  readonly decision: MemoryPolicyDecision
  readonly reason: MemoryPolicyReason
  readonly version: MemoryPolicyVersion
}

/** Exact record reference required by correcting and forgetting operations. */
export interface MemoryRef {
  readonly id: MemoryId
  readonly revision: number
}

/** Request to create one durable workspace memory. */
export interface MemoryCreateRequest {
  readonly scope: MemoryScope
  readonly content: string
  readonly source: MemorySource
  /** Optional normalized importance from zero through one. */
  readonly importance?: number
  /** Optional source confidence from zero through one. */
  readonly confidence?: number
  /** Optional confirmation class used by final retrieval ranking. */
  readonly validation?: MemoryValidation
}

/** Request to retrieve relevant memories inside one workspace. */
export interface MemorySearchRequest {
  readonly scope: MemoryScope
  readonly query: string
  readonly limit: number
}

/** One provider-ranked search result. Higher scores are more relevant. */
export interface MemorySearchHit {
  readonly record: MemoryRecord
  readonly score: number
}

/** Request to replace the content of one exact memory revision. */
export interface MemoryUpdateRequest {
  readonly scope: MemoryScope
  readonly ref: MemoryRef
  readonly content: string
}

/** Request to forget one exact memory revision. */
export interface MemoryForgetRequest {
  readonly scope: MemoryScope
  readonly ref: MemoryRef
}

/** Constant schema version for event payloads emitted by memory observability. */
export const MEMORY_EVENT_SCHEMA_VERSION = 3 as const
/** Constant schema version for durable memory records. */
export const MEMORY_RECORD_SCHEMA_VERSION = 1 as const

/** Stable event payload schema version for memory observability. */
export type MemoryEventSchemaVersion = typeof MEMORY_EVENT_SCHEMA_VERSION
/** Stable payload schema version for durable memory records. */
export type MemoryRecordSchemaVersion = typeof MEMORY_RECORD_SCHEMA_VERSION

/** Canonical shape emitted after each decision over memory candidate generation. */
export interface MemoryCandidateEvent {
  readonly schemaVersion: MemoryEventSchemaVersion
  /** Stable callsite that selected, screened, or dropped candidates. */
  readonly source: 'tool-memory'
  /** Length of the transient search query; the query text is never emitted. */
  readonly queryLength: number
  /** Total number of candidates returned by storage before filtering. */
  readonly total: number
  /** Number of candidates filtered as sensitive and therefore dropped. */
  readonly omittedSensitive: number
  /** Number of candidates actually inserted into the model context. */
  readonly inserted: number
  /** Opaque request context that generated the candidates. */
  readonly operation:
    | 'message_candidate'
    | 'memory_recall'
    | 'tool_call_memory_search'
  /** Optional content-free metadata for a newly extracted review candidate. */
  readonly category?: 'preference' | 'decision' | 'configuration' | 'procedure' | 'fact'
  readonly confidence?: number
  readonly importance?: number
  readonly sensitivity?: 'none' | 'review' | 'blocked'
  /** Deterministic policy outcome for this candidate trace. */
  readonly policyDecision?: MemoryPolicyDecision
  /** Policy reason behind the outcome. */
  readonly policyReason?: MemoryPolicyReason
  /** Version of policy active when this decision was made. */
  readonly policyVersion?: MemoryPolicyVersion
}

/** Canonical shape emitted for every successful or failed durable memory operation. */
export interface MemoryOperationEvent {
  readonly schemaVersion: MemoryEventSchemaVersion
  /** Human-readable operation verb. */
  readonly operation: 'create' | 'search' | 'update' | 'forget'
  /** Name of the selected provider, or `'unknown'` when no provider was resolved. */
  readonly provider: string
  /** Whether the operation call succeeded after provider execution. */
  readonly success: boolean
  /** Stable workspace boundary used by the request. */
  readonly workspaceId: WorkspaceId
  /** Result item count from search operations. */
  readonly resultCount?: number
  /** Memory id resolved by create/update/forget calls. */
  readonly memoryId?: MemoryId
  /** Current revision after an update result, when available. */
  readonly revision?: number
  /** Error code when the operation does not complete. */
  readonly errorCode?: string
  /** Optional normalized duration (ms) for the provider call. */
  readonly durationMs?: number
}

/** Canonical shape emitted when an action is blocked before mutating durable state. */
export interface MemoryBlockedEvent {
  readonly schemaVersion: MemoryEventSchemaVersion
  /** Stable operation blocked and the reason class. */
  readonly reason:
    | 'cross-scope-write'
    | 'sensitive-content'
    | 'provider-invalid'
    | 'provider-unavailable'
    | 'provider-missing'
    | 'validation'
  /** Stable workspace boundary used by the request. */
  readonly workspaceId: WorkspaceId
  /** Source of the block. */
  readonly source: 'memory-tool' | 'memory-runtime' | 'memory-local'
  /** Optional memory identifier for blocked update/forget flows. */
  readonly memoryId?: MemoryId
  /** Free-form details suitable for operational dashboards. */
  readonly detail?: string
}

/** Service Provider contract registered with `ctx.memory`. */
export interface MemoryProvider {
  /** Stable provider id used by deployment selection. */
  readonly id: string
  /** Cheap local usability check; must not perform network IO. */
  available(): boolean
  create(request: MemoryCreateRequest, signal?: AbortSignal): Promise<MemoryRecord>
  search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]>
  update(request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryRecord>
  forget(request: MemoryForgetRequest, signal?: AbortSignal): Promise<void>
}

/** Typed memory failure with a machine-routable open-string code. */
export class MemoryError extends HarnessError {}
