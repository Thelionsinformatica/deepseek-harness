/** Recovery policy and durable state types. @module @deepseek-ai/dsh-failure-recovery-policy/types */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identity for one independently coordinated recovery cell. */
export type RecoveryScopeKey = Branded<'RecoveryScopeKey'>

/** Stable identity for one recovery event across replay. */
export type RecoveryEventId = Branded<'RecoveryEventId'>

/** Stable identity for an operation that may acquire a dispatch lease. */
export type RecoveryOperationId = Branded<'RecoveryOperationId'>

/** Observable effect class used to decide retry and reconciliation behavior. */
export type ToolEffect = 'none' | 'reversible' | 'external' | 'destructive'

/** Last verifiable dispatch phase reported by a tool adapter. */
export type DispatchPhase = 'pre-dispatch' | 'accepted' | 'post-dispatch' | 'unknown'

/** Failure domain kept separate so provider transport never increments tool failures. */
export type OutcomeDomain = 'provider-transport' | 'tool-execution' | 'effect-outcome' | 'policy'

/** Canonical tool identity produced by tool-owned code, never by a model. */
export interface CanonicalInvocation {
  /** Exact deterministic signature for this invocation. */
  readonly signature: string
  /** Broader family that groups tool-defined, semantically equivalent argument variants. */
  readonly equivalenceFamily: string
  /** Normalized resource or external target used for operation coordination. */
  readonly normalizedTarget: string
}

/** Policy resolved for one validated invocation. */
export interface ResolvedToolPolicy extends CanonicalInvocation {
  /** Effect class for these arguments and target. */
  readonly effect: ToolEffect
  /** Whether an identical dispatch is safe without human reconciliation. */
  readonly retrySafe: boolean
  /** Provider-supported key whose reuse makes an external retry idempotent. */
  readonly idempotencyKey?: string
}

/** Static adapter-owned policy; the model cannot supply or override it. */
export interface ToolPolicy {
  /** Registered tool name this policy describes. */
  readonly toolName: string
  /** Version of the code-owned canonicalization algorithm. */
  readonly canonicalizerVersion: number
  /**
   * Resolve effect, retry, signature, family, and target for validated arguments.
   * @param argumentsValue - Parsed tool arguments.
   * @returns the complete invocation policy.
   */
  resolve(argumentsValue: unknown): ResolvedToolPolicy
}

/** Structured runtime outcome reported at the tool-adapter boundary. */
export interface InvocationOutcome {
  /** Operation whose dispatch and external effect are being reported. */
  readonly operationId: RecoveryOperationId
  /** Scope that owns recovery and reconciliation for the operation. */
  readonly scopeKey: RecoveryScopeKey
  /** Failure or uncertainty domain. */
  readonly domain: OutcomeDomain
  /** Last dispatch phase the adapter can prove. */
  readonly phase: DispatchPhase
  /** Effect class resolved before dispatch. */
  readonly effect: ToolEffect
  /** Whether the adapter contract permits an identical retry. */
  readonly retrySafe: boolean
  /** Idempotency key reused by every retry of this operation. */
  readonly idempotencyKey?: string
  /** Provider receipt used to query or reconcile an uncertain outcome. */
  readonly receipt?: string
  /** Stable error code without raw response content. */
  readonly errorCode?: string
}

/** Recovery circuit state persisted independently of the active model. */
export type RecoveryStatus = 'open' | 'warned' | 'blocked' | 'unknown-outcome'

/** Current equivalent-failure chain inside one recovery cell. */
export interface RecoveryFailure {
  /** Exact invocation signature. */
  readonly callKey: string
  /** Tool-owned equivalence family. */
  readonly familyKey: string
  /** Equivalent failure identity. */
  readonly failureKey: string
  /** Stable failure code shown in recovery guidance. */
  readonly failureCode: string
  /** Consecutive equivalent failures. */
  readonly count: number
}

/** Active operation lease. */
export interface RecoveryLease {
  /** Operation holding the lease. */
  readonly operationId: RecoveryOperationId
  /** Monotonic token that invalidates work from an expired prior holder. */
  readonly fencingToken: number
  /** Unix epoch milliseconds after which another operation may acquire the scope. */
  readonly expiresAt: number
}

/** One immutable event retained with its recovery cell. */
export interface RecoveryEvent {
  /** Replay identity. */
  readonly eventId: RecoveryEventId
  /** Owning cell. */
  readonly scopeKey: RecoveryScopeKey
  /** Monotonic per-scope sequence, equal to the committed record version. */
  readonly sequence: number
  /** State transition kind. */
  readonly type: 'failure-recorded' | 'reset' | 'unknown-outcome' | 'lease-reserved' | 'lease-released'
  /** Unix epoch milliseconds supplied by the operation owner. */
  readonly at: number
  /** Related operation when the transition concerns dispatch or reconciliation. */
  readonly operationId?: RecoveryOperationId
}

/** Complete durable state for one recovery scope. */
export interface RecoveryRecord {
  /** Owning key repeated in the value so durable validation detects mis-keyed writes. */
  readonly scopeKey: RecoveryScopeKey
  /** Monotonic commit version. */
  readonly version: number
  /** Current circuit state. */
  readonly status: RecoveryStatus
  /** Active equivalent-failure chain. */
  readonly failure?: RecoveryFailure
  /** Uncertain external result awaiting reconciliation. */
  readonly unknownOutcome?: InvocationOutcome
  /** Active dispatch lease. */
  readonly lease?: RecoveryLease
  /** Highest fencing token ever issued for this scope. */
  readonly lastFencingToken: number
  /** Immutable transitions retained for deterministic replay and audit. */
  readonly events: readonly RecoveryEvent[]
  /** Time of the latest committed transition. */
  readonly updatedAt: number
}

/** Input for one equivalent tool failure. */
export interface RecordFailureInput extends Omit<RecoveryFailure, 'count'> {
  /** Failure count at which the circuit becomes blocked. */
  readonly limit: number
}

/** Result of an atomic lease acquisition. */
export interface LeaseReservation {
  /** Whether this operation owns the returned lease. */
  readonly acquired: boolean
  /** Current holder, whether newly acquired or already active. */
  readonly lease: RecoveryLease
  /** Committed recovery record. */
  readonly record: RecoveryRecord
}

/** Atomic persistence API consumed by the recovery guard and effect adapters. */
export interface AtomicRecoveryStore {
  /**
   * Read the current committed cell synchronously.
   * @param scopeKey - recovery scope.
   * @returns the current record, or `undefined` before its first transition.
   */
  read(scopeKey: RecoveryScopeKey): RecoveryRecord | undefined
  /**
   * Record one equivalent failure idempotently.
   * @param scopeKey - recovery scope.
   * @param input - canonical invocation and failure identity.
   * @param eventId - replay identity.
   * @param at - operation time in Unix epoch milliseconds.
   * @returns the committed record.
   */
  recordFailure(scopeKey: RecoveryScopeKey, input: RecordFailureInput, eventId: RecoveryEventId, at: number): Promise<RecoveryRecord>
  /**
   * Clear failure and uncertainty state without releasing an operation lease.
   * @param scopeKey - recovery scope.
   * @param eventId - replay identity.
   * @param at - operation time in Unix epoch milliseconds.
   * @returns the committed record, or `undefined` when the scope was already absent/open.
   */
  reset(scopeKey: RecoveryScopeKey, eventId: RecoveryEventId, at: number): Promise<RecoveryRecord | undefined>
  /**
   * Persist an outcome whose external effect cannot yet be proven.
   * @param outcome - adapter-reported uncertain outcome.
   * @param eventId - replay identity.
   * @param at - operation time in Unix epoch milliseconds.
   * @returns the committed record.
   */
  markUnknownOutcome(outcome: InvocationOutcome, eventId: RecoveryEventId, at: number): Promise<RecoveryRecord>
  /**
   * Acquire or observe a single operation lease for one scope.
   * @param scopeKey - coordination scope.
   * @param operationId - proposed holder.
   * @param ttlMs - positive lease lifetime.
   * @param eventId - replay identity.
   * @param at - acquisition time.
   * @returns the holder and acquisition decision.
   */
  reserve(
    scopeKey: RecoveryScopeKey,
    operationId: RecoveryOperationId,
    ttlMs: number,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<LeaseReservation>
  /**
   * Release only the matching current lease and fencing token.
   * @param scopeKey - coordination scope.
   * @param operationId - releasing holder.
   * @param fencingToken - token returned by reserve.
   * @param eventId - replay identity.
   * @param at - release time.
   * @returns whether this call released the lease.
   */
  release(
    scopeKey: RecoveryScopeKey,
    operationId: RecoveryOperationId,
    fencingToken: number,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<boolean>
}
