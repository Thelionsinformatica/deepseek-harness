/** Durable schema owned by the local memory provider. @module @deepseek-ai/dsh-memory-local/spec */

import { z } from 'zod'
import { SessionId, type SessionId as SessionIdentity } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type WorkspaceId as WorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  type MemoryRecordSchemaVersion,
  type MemoryValidation,
  MEMORY_RECORD_SCHEMA_VERSION,
  MemoryId,
} from '@deepseek-ai/dsh-memory'

/** Stored record shape; the table key carries the public memory id. */
export interface LocalMemoryRecord {
  readonly workspaceId: WorkspaceIdentity
  readonly content: string
  readonly revision: number
  readonly source: { readonly kind: 'session'; readonly sessionId: SessionIdentity }
  readonly importance?: number
  readonly confidence?: number
  readonly validation?: MemoryValidation
  readonly schemaVersion: MemoryRecordSchemaVersion
  readonly createdAt: string
  readonly updatedAt: string
}

/** Boundary validator whose public declaration names only installed package types. */
export const localMemoryRecord = z.object({
  workspaceId: z.string().transform(WorkspaceId),
  content: z.string(),
  revision: z.number().int().positive(),
  source: z.object({
    kind: z.literal('session'),
    sessionId: z.string().transform(SessionId),
  }),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validation: z.enum(['explicit', 'reviewed']).optional(),
  schemaVersion: z.number().int().positive().optional().default(MEMORY_RECORD_SCHEMA_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
}) as unknown as z.ZodType<LocalMemoryRecord>

/** One versioned table routed through the host's configured storage backend. */
export const localMemoryDomainSpec = defineDomain({
  name: 'memory_local',
  version: 1,
  tables: { memories: domainTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>(localMemoryRecord) },
})
