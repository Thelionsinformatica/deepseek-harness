/** Shadow durable schema for extracted memory candidates. @module @deepseek-ai/dsh-tool-memory/spec */

import { z } from 'zod'
import { SessionId, type SessionId as SessionIdentity } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type WorkspaceId as WorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MEMORY_POLICY_VERSION,
  MemoryId,
  type MemoryPolicyDecision,
  type MemoryPolicyReason,
  type MemoryPolicyVersion,
} from '@deepseek-ai/dsh-memory'
import { PersonalMemoryOwnerId, type PersonalMemoryOwnerIdentity } from '@deepseek-ai/dsh-personal-memory'
import {
  MemoryCandidateId,
  MemoryAdminActionId,
  type MemoryCandidateCategory,
  type MemoryCandidateAutoWriteTrace,
  type MemoryCandidateOperation,
  type MemoryCandidateReviewDecision,
  type MemoryCandidateSensitivity,
} from './types.ts'

export type {
  MemoryCandidateCategory,
  MemoryCandidateOperation,
  MemoryCandidateReviewDecision,
  MemoryCandidateSensitivity,
} from './types.ts'
export { MemoryCandidateId } from './types.ts'

/** Schema version for the durable shadow candidate domain. */
export const MEMORY_CANDIDATE_SCHEMA_VERSION = 3 as const
/** Stable schema version for persisted candidate snapshots. */
export type MemoryCandidateSchemaVersion = 2 | typeof MEMORY_CANDIDATE_SCHEMA_VERSION

/** One persisted candidate snapshot for review and decision policy tuning. */
export interface MemoryCandidateRecord {
  readonly id: MemoryCandidateId
  readonly workspaceId: WorkspaceIdentity
  readonly sessionId: SessionIdentity
  readonly userId?: string
  readonly source: 'tool-memory'
  readonly operation: MemoryCandidateOperation
  readonly queryLength: number
  readonly confidence: number
  readonly total: number
  readonly omittedSensitive: number
  readonly inserted: number
  readonly topScore: number
  readonly candidateContent?: string
  readonly category?: MemoryCandidateCategory
  readonly importance?: number
  readonly scopeCandidate?: 'workspace'
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
  readonly schemaVersion: MemoryCandidateSchemaVersion
}

/** Boundary schema for one shadow candidate row. */
export const memoryCandidateRecord = z.object({
  id: z.string().transform(MemoryCandidateId),
  workspaceId: z.string().transform(WorkspaceId),
  sessionId: z.string().transform(SessionId),
  userId: z.string().optional(),
  source: z.literal('tool-memory'),
  operation: z.union([
    z.literal('message_candidate'),
    z.literal('memory_recall'),
    z.literal('tool_call_memory_search'),
  ]),
  queryLength: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  total: z.number().int().min(0),
  omittedSensitive: z.number().int().min(0),
  inserted: z.number().int().min(0),
  topScore: z.number(),
  candidateContent: z.string().optional(),
  category: z.enum(['preference', 'decision', 'configuration', 'procedure', 'fact']).optional(),
  importance: z.number().min(0).max(1).optional(),
  scopeCandidate: z.literal('workspace').optional(),
  sensitivity: z.enum(['none', 'review', 'blocked']).optional(),
  policyVersion: z.number().int().positive().default(MEMORY_POLICY_VERSION),
  policyDecision: z.enum(['block', 'reject', 'shadow', 'confirm', 'store']),
  policyReason: z.enum([
    'no-candidates',
    'all-candidates-sensitive',
    'low-confidence',
    'credential-signal',
    'candidate-extracted',
    'sensitivity-review-required',
    'high-confidence',
    'moderate-confidence',
  ]),
  reviewed: z.boolean().default(false),
  reviewDecision: z.enum(['accept', 'ignore', 'reject']).optional(),
  reviewedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  autoWrite: z.object({
    status: z.enum(['skipped', 'writing', 'stored', 'failed']),
    reason: z.enum([
      'feature-disabled',
      'workspace-not-enabled',
      'user-not-enabled',
      'policy-not-eligible',
      'human-ignored',
      'human-rejected',
      'write-started',
      'approved-and-authorized',
      'provider-failed',
    ]),
    recordedAt: z.string(),
    memoryId: z.string().optional(),
    revision: z.number().int().positive().optional(),
  }).optional(),
  createdAt: z.string(),
  schemaVersion: z.number().int().positive().default(MEMORY_CANDIDATE_SCHEMA_VERSION),
}) as unknown as z.ZodType<MemoryCandidateRecord>

/** Durable shadow store for automatic recall/search candidate traces. */
export const memoryCandidateDomainSpec = defineDomain({
  name: 'memory_candidate',
  version: 2,
  tables: { candidates: domainTable<ReturnType<typeof MemoryCandidateId>, MemoryCandidateRecord>(memoryCandidateRecord) },
})

/** Durable, content-free trace of one user-confirmed memory administration action. */
export interface MemoryAdminActionRecord {
  readonly id: MemoryAdminActionId
  readonly workspaceId: WorkspaceIdentity
  readonly sessionId: SessionIdentity
  readonly memoryId: ReturnType<typeof MemoryId>
  readonly expectedRevision: number
  readonly resultRevision?: number
  readonly action: 'correct' | 'forget'
  readonly status: 'requested' | 'succeeded' | 'failed'
  readonly failureCode?: string
  readonly createdAt: string
  readonly completedAt?: string
}

/** Boundary schema for a content-free administrative mutation trace. */
export const memoryAdminActionRecord = z.object({
  id: z.string().transform(MemoryAdminActionId),
  workspaceId: z.string().transform(WorkspaceId),
  sessionId: z.string().transform(SessionId),
  memoryId: z.string().transform(MemoryId),
  expectedRevision: z.number().int().positive(),
  resultRevision: z.number().int().positive().optional(),
  action: z.enum(['correct', 'forget']),
  status: z.enum(['requested', 'succeeded', 'failed']),
  failureCode: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
}) as unknown as z.ZodType<MemoryAdminActionRecord>

/** Separate audit domain so the existing candidate queue remains migration-compatible. */
export const memoryAdminDomainSpec = defineDomain({
  name: 'memory_admin',
  version: 1,
  tables: {
    actions: domainTable<ReturnType<typeof MemoryAdminActionId>, MemoryAdminActionRecord>(memoryAdminActionRecord),
  },
})

/** Durable, content-free trace of one user-confirmed personal-memory administration action. */
export interface PersonalMemoryAdminActionRecord {
  readonly id: MemoryAdminActionId
  readonly ownerId: PersonalMemoryOwnerIdentity
  readonly sessionId: SessionIdentity
  readonly memoryId?: ReturnType<typeof MemoryId>
  readonly expectedRevision?: number
  readonly resultRevision?: number
  readonly desiredEnabled?: boolean
  readonly action: 'remember' | 'correct' | 'forget' | 'toggle'
  readonly status: 'requested' | 'succeeded' | 'failed'
  readonly failureCode?: string
  readonly createdAt: string
  readonly completedAt?: string
}

/** Boundary schema for a content-free personal-memory administrative trace. */
export const personalMemoryAdminActionRecord = z.object({
  id: z.string().transform(MemoryAdminActionId),
  ownerId: z.string().transform(PersonalMemoryOwnerId),
  sessionId: z.string().transform(SessionId),
  memoryId: z.string().transform(MemoryId).optional(),
  expectedRevision: z.number().int().positive().optional(),
  resultRevision: z.number().int().positive().optional(),
  desiredEnabled: z.boolean().optional(),
  action: z.enum(['remember', 'correct', 'forget', 'toggle']),
  status: z.enum(['requested', 'succeeded', 'failed']),
  failureCode: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
}) as unknown as z.ZodType<PersonalMemoryAdminActionRecord>

/** Separate personal audit domain so workspace and owner activity never share a partition. */
export const personalMemoryAdminDomainSpec = defineDomain({
  name: 'personal_memory_admin',
  version: 1,
  tables: {
    actions: domainTable<ReturnType<typeof MemoryAdminActionId>, PersonalMemoryAdminActionRecord>(
      personalMemoryAdminActionRecord,
    ),
  },
})
