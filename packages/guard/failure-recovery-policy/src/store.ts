/** Atomic recovery stores over memory or the durable domain data form. */

import type { KvRecordMutation, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  AtomicRecoveryStore,
  InvocationOutcome,
  LeaseReservation,
  RecordFailureInput,
  RecoveryEvent,
  RecoveryEventId,
  RecoveryFailure,
  RecoveryLease,
  RecoveryOperationId,
  RecoveryRecord,
  RecoveryScopeKey,
  RecoveryStatus,
} from './types.ts'

/** Minimal atomic record table required by the recovery state machine. */
interface RecoveryTable {
  /** Return the current committed value. */
  get(key: RecoveryScopeKey): RecoveryRecord | undefined
  /** Serialize one conditional mutation. */
  mutate<R>(key: RecoveryScopeKey, fn: (current: RecoveryRecord | undefined) => KvRecordMutation<RecoveryRecord, R>): Promise<R>
}

/** Shared state transitions; table implementations own serialization and durability. */
class RecoveryStore implements AtomicRecoveryStore {
  constructor(private readonly table: RecoveryTable) {}

  read(scopeKey: RecoveryScopeKey): RecoveryRecord | undefined {
    return this.table.get(scopeKey)
  }

  recordFailure(
    scopeKey: RecoveryScopeKey,
    input: RecordFailureInput,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<RecoveryRecord> {
    return this.table.mutate(scopeKey, (current) => {
      const replay = replayed(current, eventId)
      if (replay !== undefined) return { kind: 'keep', result: replay }
      const prior = current?.failure
      const count = prior !== undefined
        && prior.callKey === input.callKey
        && prior.familyKey === input.familyKey
        && prior.failureKey === input.failureKey
        ? prior.count + 1
        : 1
      const failure = {
        callKey: input.callKey,
        familyKey: input.familyKey,
        failureKey: input.failureKey,
        failureCode: input.failureCode,
        count,
      }
      const base = current ?? emptyRecord(scopeKey, at)
      const next = commit(base, {
        status: count >= input.limit ? 'blocked' : 'warned',
        failure,
        unknownOutcome: null,
      }, eventId, 'failure-recorded', at)
      return { kind: 'put', value: next, result: next }
    })
  }

  reset(
    scopeKey: RecoveryScopeKey,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<RecoveryRecord | undefined> {
    return this.table.mutate(scopeKey, (current) => {
      if (current === undefined) return { kind: 'keep', result: undefined }
      const replay = replayed(current, eventId)
      if (replay !== undefined) return { kind: 'keep', result: replay }
      if (current.failure === undefined && current.unknownOutcome === undefined && current.status === 'open') {
        return { kind: 'keep', result: current }
      }
      const next = commit(current, {
        status: 'open',
        failure: null,
        unknownOutcome: null,
      }, eventId, 'reset', at)
      return { kind: 'put', value: next, result: next }
    })
  }

  markUnknownOutcome(
    outcome: InvocationOutcome,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<RecoveryRecord> {
    return this.table.mutate(outcome.scopeKey, (current) => {
      const replay = replayed(current, eventId)
      if (replay !== undefined) return { kind: 'keep', result: replay }
      const base = current ?? emptyRecord(outcome.scopeKey, at)
      const next = commit(base, {
        status: 'unknown-outcome',
        unknownOutcome: outcome,
      }, eventId, 'unknown-outcome', at, outcome.operationId)
      return { kind: 'put', value: next, result: next }
    })
  }

  reserve(
    scopeKey: RecoveryScopeKey,
    operationId: RecoveryOperationId,
    ttlMs: number,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<LeaseReservation> {
    return this.table.mutate(scopeKey, (current) => {
      const replay = replayed(current, eventId)
      if (replay !== undefined && replay.lease !== undefined) {
        return {
          kind: 'keep',
          result: { acquired: replay.lease.operationId === operationId, lease: replay.lease, record: replay },
        }
      }
      if (current !== undefined) {
        const active = current.lease
        if (active !== undefined && active.expiresAt > at) {
          return {
            kind: 'keep',
            result: { acquired: active.operationId === operationId, lease: active, record: current },
          }
        }
      }
      const base = current ?? emptyRecord(scopeKey, at)
      const lease = {
        operationId,
        fencingToken: base.lastFencingToken + 1,
        expiresAt: at + ttlMs,
      }
      const next = commit(base, {
        lease,
        lastFencingToken: lease.fencingToken,
      }, eventId, 'lease-reserved', at, operationId)
      return { kind: 'put', value: next, result: { acquired: true, lease, record: next } }
    })
  }

  release(
    scopeKey: RecoveryScopeKey,
    operationId: RecoveryOperationId,
    fencingToken: number,
    eventId: RecoveryEventId,
    at: number,
  ): Promise<boolean> {
    return this.table.mutate(scopeKey, (current) => {
      if (current === undefined) return { kind: 'keep', result: false }
      if (replayed(current, eventId) !== undefined) return { kind: 'keep', result: true }
      if (current.lease?.operationId !== operationId || current.lease.fencingToken !== fencingToken) {
        return { kind: 'keep', result: false }
      }
      const next = commit(current, { lease: null }, eventId, 'lease-released', at, operationId)
      return { kind: 'put', value: next, result: true }
    })
  }
}

/** Durable atomic store over one opened storage-domain table. */
export class DomainAtomicRecoveryStore extends RecoveryStore {
  /**
   * Bind recovery transitions to the deployment's durable table.
   * @param table - opened recovery table whose write chain is the commit serializer.
   */
  // oxlint-disable-next-line eslint/no-useless-constructor -- narrows the public input to a storage-domain table.
  constructor(table: KvTable<RecoveryScopeKey, RecoveryRecord>) {
    super(table)
  }
}

/** Process-local store for tests and hosts that deliberately omit durable storage. */
export class MemoryAtomicRecoveryStore extends RecoveryStore {
  constructor() {
    super(new MemoryRecoveryTable())
  }
}

/** In-memory table that preserves the same serialized mutation semantics. */
class MemoryRecoveryTable implements RecoveryTable {
  private readonly records = new Map<RecoveryScopeKey, RecoveryRecord>()
  private tail: Promise<void> = Promise.resolve()

  get(key: RecoveryScopeKey): RecoveryRecord | undefined {
    return this.records.get(key)
  }

  mutate<R>(
    key: RecoveryScopeKey,
    fn: (current: RecoveryRecord | undefined) => KvRecordMutation<RecoveryRecord, R>,
  ): Promise<R> {
    const result = this.tail.then(() => {
      const decision = fn(this.records.get(key))
      if (decision.kind === 'put') this.records.set(key, decision.value)
      return decision.result
    })
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

/** Empty cell before its first committed event. */
function emptyRecord(scopeKey: RecoveryScopeKey, at: number): RecoveryRecord {
  return {
    scopeKey,
    version: 0,
    status: 'open',
    lastFencingToken: 0,
    events: [],
    updatedAt: at,
  }
}

/** Return the current record when one event was already committed. */
function replayed(current: RecoveryRecord | undefined, eventId: RecoveryEventId): RecoveryRecord | undefined {
  return current?.events.some(event => event.eventId === eventId) === true ? current : undefined
}

/** Fields that may change in one committed transition. */
interface RecoveryPatch {
  readonly status?: RecoveryStatus
  readonly failure?: RecoveryFailure | null
  readonly unknownOutcome?: InvocationOutcome | null
  readonly lease?: RecoveryLease | null
  readonly lastFencingToken?: number
}

/** Create the next immutable record and append its per-scope event. */
function commit(
  current: RecoveryRecord,
  patch: RecoveryPatch,
  eventId: RecoveryEventId,
  type: RecoveryEvent['type'],
  at: number,
  operationId?: RecoveryOperationId,
): RecoveryRecord {
  const version = current.version + 1
  const event: RecoveryEvent = {
    eventId,
    scopeKey: current.scopeKey,
    sequence: version,
    type,
    at,
    ...(operationId === undefined ? {} : { operationId }),
  }
  const { failure, unknownOutcome, lease, ...scalarPatch } = patch
  let next: RecoveryRecord = {
    ...current,
    ...scalarPatch,
    version,
    events: [...current.events, event],
    updatedAt: at,
  }
  if (failure === null) {
    const { failure: _omitted, ...withoutFailure } = next
    next = withoutFailure
  } else if (failure !== undefined) {
    next = { ...next, failure }
  }
  if (unknownOutcome === null) {
    const { unknownOutcome: _omitted, ...withoutUnknownOutcome } = next
    next = withoutUnknownOutcome
  } else if (unknownOutcome !== undefined) {
    next = { ...next, unknownOutcome }
  }
  if (lease === null) {
    const { lease: _omitted, ...withoutLease } = next
    next = withoutLease
  } else if (lease !== undefined) {
    next = { ...next, lease }
  }
  return next
}
