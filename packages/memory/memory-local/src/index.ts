/**
 * Local durable memory Service Provider over `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-memory-local
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryError,
  MemoryId,
  MEMORY_EVENT_SCHEMA_VERSION,
  MEMORY_RECORD_SCHEMA_VERSION,
  type MemoryBlockedEvent,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
  type MemoryProvider,
  type MemoryRecord,
  type MemorySearchHit,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import { localMemoryDomainSpec } from './spec.ts'
import type { LocalMemoryRecord } from './spec.ts'

export { localMemoryDomainSpec, localMemoryRecord } from './spec.ts'
export type { LocalMemoryRecord } from './spec.ts'

export const name = 'memory-local'
export const inject = ['memory', 'storageDomain']

/** Durable, dependency-free lexical memory provider for local deployments. */
export class LocalMemoryProvider implements MemoryProvider {
  readonly id = 'local'
  private operationTail: Promise<void> = Promise.resolve()
  constructor(
    private readonly table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
    private readonly emitBlocked?: (event: Omit<MemoryBlockedEvent, 'schemaVersion'>) => void,
  ) {}

  available(): boolean {
    return true
  }

  create(request: MemoryCreateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      assertNotAborted(signal)
      const id = MemoryId(randomUUID())
      const now = new Date().toISOString()
      const stored: LocalMemoryRecord = {
        workspaceId: request.scope.workspaceId,
        content: request.content,
        revision: 1,
        source: request.source,
        schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      }
      await this.table.put(id, stored)
      return project(id, stored)
    })
  }

  search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]> {
    assertNotAborted(signal)
    const query = normalize(request.query)
    const terms = uniqueTokens(query)
    const hits: MemorySearchHit[] = []
    for (const [id, stored] of this.table.entries()) {
      if (stored.workspaceId !== request.scope.workspaceId) continue
      const candidate = normalize(stored.content)
      const matched = terms.filter(term => candidate.includes(term)).length
      if (matched === 0 && !candidate.includes(query)) continue
      const exactPhrase = candidate.includes(query) ? 2 : 0
      const coverage = terms.length === 0 ? 0 : matched / terms.length
      hits.push({ record: project(id, stored), score: exactPhrase + coverage })
    }
    hits.sort((left, right) => right.score - left.score
      || right.record.updatedAt.localeCompare(left.record.updatedAt)
      || String(left.record.id).localeCompare(String(right.record.id)))
    assertNotAborted(signal)
    return Promise.resolve(hits.slice(0, request.limit))
  }

  update(request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      assertNotAborted(signal)
      try {
        return project(request.ref.id, await this.table.update(request.ref.id, (current) => {
          assertVisibleRevision(
            current,
            request.scope.workspaceId,
            request.ref.id,
            request.ref.revision,
            this.emitBlocked,
          )
          return {
            ...current,
            content: request.content,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          }
        }))
      } catch (error) {
        throw translateMissing(error, request.ref.id)
      }
    })
  }

  forget(request: MemoryForgetRequest, signal?: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      assertNotAborted(signal)
      const current = this.table.get(request.ref.id)
      if (current === undefined) throw notFound(request.ref.id)
      assertVisibleRevision(
        current,
        request.scope.workspaceId,
        request.ref.id,
        request.ref.revision,
        this.emitBlocked,
      )
      await this.table.delete(request.ref.id)
    })
  }

  /** Serialize local mutations so revision checks and their durable write are one provider operation. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(job)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

/** Open the provider-owned domain, register the provider, and couple both lifecycles to this fiber. */
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(localMemoryDomainSpec)
  ctx.effect(() => () => domain.close(), 'memory-local.domainClose')
  const provider = new LocalMemoryProvider(domain.table('memories'), (event) => {
    if (event.reason !== 'cross-scope-write') return
    ctx.emit('memory/blocked', {
      ...event,
      schemaVersion: MEMORY_EVENT_SCHEMA_VERSION,
      source: 'memory-local',
    })
  })
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-local.registerProvider')
}

function project(id: ReturnType<typeof MemoryId>, stored: LocalMemoryRecord): MemoryRecord {
  return {
    id,
    scope: { workspaceId: stored.workspaceId },
    content: stored.content,
    revision: stored.revision,
    schemaVersion: stored.schemaVersion,
    source: stored.source,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/** Accent-insensitive, case-insensitive text used only for local lexical ranking. */
function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

function uniqueTokens(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]+/gu) ?? [])]
}

/** Hide cross-workspace existence behind the same miss used for an unknown id. */
function assertVisibleRevision(
  record: LocalMemoryRecord,
  workspaceId: LocalMemoryRecord['workspaceId'],
  memoryId: MemoryId,
  revision: number,
  emitBlocked?: (event: Omit<MemoryBlockedEvent, 'schemaVersion'>) => void,
): void {
  if (record.workspaceId !== workspaceId) {
    emitBlocked?.({
      reason: 'cross-scope-write',
      source: 'memory-local',
      workspaceId,
      memoryId,
      detail: `memory belongs to workspace ${record.workspaceId}`,
    })
    throw notFound('scoped memory')
  }
  if (record.revision !== revision) {
    throw new MemoryError(
      `memory revision conflict: expected ${revision}, current revision is ${record.revision}`,
      'MEMORY_REVISION_CONFLICT',
    )
  }
}

function notFound(id: unknown): MemoryError {
  return new MemoryError(`memory "${String(id)}" was not found in this workspace`, 'MEMORY_NOT_FOUND')
}

function translateMissing(error: unknown, id: unknown): unknown {
  if (error instanceof DomainError && error.code === 'missing-key') return notFound(id)
  return error
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new MemoryError('memory operation aborted', 'MEMORY_ABORTED')
}
