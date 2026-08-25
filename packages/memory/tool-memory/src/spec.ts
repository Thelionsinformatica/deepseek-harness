/** Shadow durable schema for extracted memory candidates. @module @deepseek-ai/dsh-tool-memory/spec */

import { z } from 'zod'
import { SessionId, type SessionId as SessionIdentity } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type WorkspaceId as WorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MEMORY_POLICY_VERSION,
  type MemoryPolicyDecision,
  type MemoryPolicyReason,
  type MemoryPolicyVersion,
} from '@deepseek-ai/dsh-memory'
import {
  MemoryCandidateId,
  type MemoryCandidateCategory,
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
  createdAt: z.string(),
  schemaVersion: z.number().int().positive().default(MEMORY_CANDIDATE_SCHEMA_VERSION),
}) as unknown as z.ZodType<MemoryCandidateRecord>

/** Durable shadow store for automatic recall/search candidate traces. */
export const memoryCandidateDomainSpec = defineDomain({
  name: 'memory_candidate',
  version: 2,
  tables: { candidates: domainTable<ReturnType<typeof MemoryCandidateId>, MemoryCandidateRecord>(memoryCandidateRecord) },
})
