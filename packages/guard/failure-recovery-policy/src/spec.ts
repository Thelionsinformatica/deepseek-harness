/** Durable recovery record schema. @module @deepseek-ai/dsh-failure-recovery-policy/spec */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RecoveryEventId, RecoveryOperationId, RecoveryScopeKey } from './contracts.ts'
import type { RecoveryRecord } from './types.ts'

const operationId = z.string().transform(RecoveryOperationId)
const scopeKey = z.string().transform(RecoveryScopeKey)

const failure = z.object({
  callKey: z.string(),
  familyKey: z.string(),
  failureKey: z.string(),
  failureCode: z.string(),
  count: z.number().int().positive(),
})

const lease = z.object({
  operationId,
  fencingToken: z.number().int().positive(),
  expiresAt: z.number().int().nonnegative(),
})

const invocationOutcome = z.object({
  operationId,
  scopeKey,
  domain: z.enum(['provider-transport', 'tool-execution', 'effect-outcome', 'policy']),
  phase: z.enum(['pre-dispatch', 'accepted', 'post-dispatch', 'unknown']),
  effect: z.enum(['none', 'reversible', 'external', 'destructive']),
  retrySafe: z.boolean(),
  idempotencyKey: z.string().exactOptional(),
  receipt: z.string().exactOptional(),
  errorCode: z.string().exactOptional(),
})

const recoveryEvent = z.object({
  eventId: z.string().transform(RecoveryEventId),
  scopeKey,
  sequence: z.number().int().positive(),
  type: z.enum(['failure-recorded', 'reset', 'unknown-outcome', 'lease-reserved', 'lease-released']),
  at: z.number().int().nonnegative(),
  operationId: operationId.exactOptional(),
})

/** Boundary validator for every persisted recovery cell. */
export const recoveryRecord: z.ZodType<RecoveryRecord> = z.object({
  scopeKey,
  version: z.number().int().positive(),
  status: z.enum(['open', 'warned', 'blocked', 'unknown-outcome']),
  failure: failure.exactOptional(),
  unknownOutcome: invocationOutcome.exactOptional(),
  lease: lease.exactOptional(),
  lastFencingToken: z.number().int().nonnegative(),
  events: z.array(recoveryEvent),
  updatedAt: z.number().int().nonnegative(),
})

/** Durable table routed through the deployment's configured storage backend. */
export const failureRecoveryDomainSpec = defineDomain({
  name: 'failure_recovery',
  version: 1,
  tables: {
    scopes: domainTable<ReturnType<typeof RecoveryScopeKey>, RecoveryRecord>(recoveryRecord),
  },
})
