import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  DomainAtomicRecoveryStore,
  MemoryAtomicRecoveryStore,
  RecoveryEventId,
  RecoveryOperationId,
  RecoveryScopeKey,
  failureRecoveryDomainSpec,
  type AtomicRecoveryStore,
} from '@deepseek-ai/dsh-failure-recovery-policy'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const failure = {
  callKey: 'probe:{"target":"x"}',
  familyKey: 'probe:target:x',
  failureKey: 'HarnessError:TEST_FAILURE',
  failureCode: 'TEST_FAILURE',
  limit: 2,
} as const

describe.each([
  ['memory', async () => new MemoryAtomicRecoveryStore() as AtomicRecoveryStore],
  ['domain', async () => (await domainHarness()).store as AtomicRecoveryStore],
] as const)('atomic recovery store: %s', (_name, createStore) => {
  it('serializes concurrent failures and deduplicates replayed events', async () => {
    const store = await createStore()
    const scope = RecoveryScopeKey('session:concurrent')
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.recordFailure(scope, failure, RecoveryEventId(`failure:${index}`), index)))
    const replayed = await store.recordFailure(scope, failure, RecoveryEventId('failure:19'), 100)

    expect(replayed.failure?.count).toBe(20)
    expect(replayed.version).toBe(20)
    expect(replayed.events).toHaveLength(20)
  })

  it('uses leases and fencing tokens to prevent duplicate operation ownership', async () => {
    const store = await createStore()
    const scope = RecoveryScopeKey('workspace:w1:send_message:user-1')
    const firstOperation = RecoveryOperationId('send-1')
    const secondOperation = RecoveryOperationId('send-2')
    const [first, competing] = await Promise.all([
      store.reserve(scope, firstOperation, 100, RecoveryEventId('reserve-1'), 1_000),
      store.reserve(scope, secondOperation, 100, RecoveryEventId('reserve-2'), 1_000),
    ])
    const winner = first.acquired ? first : competing
    const loser = first.acquired ? competing : first
    const loserOperation = first.acquired ? secondOperation : firstOperation
    const afterExpiry = await store.reserve(
      scope, loserOperation, 100, RecoveryEventId('reserve-after-expiry'), 1_101,
    )

    expect(winner.acquired).toBe(true)
    expect(loser.acquired).toBe(false)
    expect(afterExpiry.acquired).toBe(true)
    expect(afterExpiry.lease.fencingToken).toBeGreaterThan(winner.lease.fencingToken)
    await expect(store.release(
      scope, winner.lease.operationId, winner.lease.fencingToken, RecoveryEventId('stale-release'), 1_102,
    )).resolves.toBe(false)
    await expect(store.release(
      scope, afterExpiry.lease.operationId, afterExpiry.lease.fencingToken, RecoveryEventId('release-current'), 1_103,
    )).resolves.toBe(true)
  })

  it('persists an uncertain external effect without treating it as a tool failure', async () => {
    const store = await createStore()
    const scope = RecoveryScopeKey('workspace:w1:purchase:order-7')
    const outcome = {
      operationId: RecoveryOperationId('purchase-7'),
      scopeKey: scope,
      domain: 'effect-outcome',
      phase: 'unknown',
      effect: 'external',
      retrySafe: false,
      idempotencyKey: 'order-7',
      errorCode: 'HTTP_504',
    } as const
    const stored = await store.markUnknownOutcome(outcome, RecoveryEventId('unknown-7'), 7)
    const replayed = await store.markUnknownOutcome(outcome, RecoveryEventId('unknown-7'), 8)

    expect(stored).toMatchObject({ status: 'unknown-outcome', version: 1, unknownOutcome: outcome })
    expect(stored.failure).toBeUndefined()
    expect(replayed.version).toBe(1)
  })
})

describe('durable recovery state', () => {
  it('survives a domain close and reopen without changing version or failure count', async () => {
    const pool = new MemoryMediaPool()
    const first = await domainHarness(pool)
    const scope = RecoveryScopeKey('session:resume')
    await first.store.recordFailure(scope, failure, RecoveryEventId('persisted-failure'), 1)
    await first.domain.close()

    const second = await domainHarness(pool)
    expect(second.store.read(scope)).toMatchObject({
      version: 1,
      status: 'warned',
      failure: { count: 1, failureCode: 'TEST_FAILURE' },
    })
  })
})

/** Open the recovery domain over a reusable in-memory durable medium. */
async function domainHarness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  const domain = await facility.open(failureRecoveryDomainSpec)
  return { ctx, domain, store: new DomainAtomicRecoveryStore(domain.table('scopes')) }
}
