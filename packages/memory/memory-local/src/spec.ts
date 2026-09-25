/** Durable schema owned by the local memory provider. @module @deepseek-ai/dsh-memory-local/spec */

import { z } from 'zod'
import { SessionId, type SessionId as SessionIdentity } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type WorkspaceId as WorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  type MemoryRecordSchemaVersion,
  type MemoryRef,
  type MemoryValidation,
  MEMORY_RECORD_SCHEMA_VERSION,
  MemoryId,
} from '@deepseek-ai/dsh-memory'

/** One immutable historical revision nested inside its current lineage record. */
export interface LocalMemoryVersion {
  readonly content: string
  readonly revision: number
  readonly source: { readonly kind: 'session'; readonly sessionId: SessionIdentity }
  readonly importance?: number
  readonly confidence?: number
  readonly validation?: MemoryValidation
  readonly core?: boolean
  readonly schemaVersion: MemoryRecordSchemaVersion
  readonly validFrom?: string
  readonly validUntil?: string
  readonly expiresAt?: string
  readonly supersedes?: MemoryRef
  readonly supersededBy?: MemoryRef
  readonly createdAt: string
  readonly updatedAt: string
}

/** Stored lineage shape; the table key carries the public memory id. */
export interface LocalMemoryRecord extends LocalMemoryVersion {
  readonly workspaceId: WorkspaceIdentity
  readonly history?: readonly LocalMemoryVersion[]
}

/** Durable edge row inside one atomically published workspace graph snapshot. */
export interface LocalMemoryGraphEdge {
  readonly a: MemoryRef
  readonly b: MemoryRef
  readonly score: number
  readonly kind: 'semantic'
}

/**
 * One bounded similarity-graph snapshot published atomically per workspace.
 * The table key carries the workspace id; absent rows mean not yet computed.
 */
export interface LocalMemoryGraph {
  readonly workspaceId: WorkspaceIdentity
  readonly status: 'computed' | 'empty' | 'failed'
  /** Monotonic computation counter; a newer commit invalidates an in-flight computation. */
  readonly generation: number
  readonly algorithmVersion: number
  readonly model: string
  readonly api: 'ollama' | 'openai-compatible'
  readonly minScore: number
  readonly maxEdgesPerNode: number
  readonly computedAt: string
  /** Exact record revisions the edges were computed against. */
  readonly recordRevisions: Record<string, number>
  readonly edges: readonly LocalMemoryGraphEdge[]
  readonly failureCode?: string
}

const memoryRef = z.object({
  id: z.string().transform(MemoryId),
  revision: z.number().int().positive(),
})

const localMemoryVersionFields = {
  content: z.string(),
  revision: z.number().int().positive(),
  source: z.object({
    kind: z.literal('session'),
    sessionId: z.string().transform(SessionId),
  }),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validation: z.enum(['explicit', 'reviewed']).optional(),
  core: z.boolean().optional(),
  schemaVersion: z.union([z.literal(1), z.literal(MEMORY_RECORD_SCHEMA_VERSION)]).optional().default(1),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  expiresAt: z.string().optional(),
  supersedes: memoryRef.optional(),
  supersededBy: memoryRef.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
} as const

/** Boundary validator for one nested historical revision. */
export const localMemoryVersion = z.object(localMemoryVersionFields) as unknown as z.ZodType<LocalMemoryVersion>

/** Boundary validator whose public declaration names only installed package types. */
export const localMemoryRecord = z.object({
  workspaceId: z.string().transform(WorkspaceId),
  ...localMemoryVersionFields,
  history: z.array(localMemoryVersion).optional(),
}) as unknown as z.ZodType<LocalMemoryRecord>

const localMemoryGraphEdge = z.object({
  a: memoryRef,
  b: memoryRef,
  score: z.number().min(-1).max(1),
  kind: z.literal('semantic'),
})

/** Boundary validator for one persisted workspace graph snapshot. */
export const localMemoryGraph = z.object({
  workspaceId: z.string().transform(WorkspaceId),
  status: z.enum(['computed', 'empty', 'failed']),
  generation: z.number().int().nonnegative(),
  algorithmVersion: z.number().int().positive(),
  model: z.string(),
  api: z.enum(['ollama', 'openai-compatible']),
  minScore: z.number().min(-1).max(1),
  maxEdgesPerNode: z.number().int().positive(),
  computedAt: z.string(),
  recordRevisions: z.record(z.string(), z.number().int().positive()),
  edges: z.array(localMemoryGraphEdge),
  failureCode: z.string().optional(),
}) as unknown as z.ZodType<LocalMemoryGraph>

/** One versioned table routed through the host's configured storage backend. */
export const localMemoryDomainSpec = defineDomain({
  name: 'memory_local',
  version: 1,
  tables: {
    memories: domainTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>(localMemoryRecord),
    graph: domainTable<WorkspaceIdentity, LocalMemoryGraph>(localMemoryGraph),
  },
})
