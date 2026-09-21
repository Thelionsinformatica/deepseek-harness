/**
 * Bounded, service-scheduled similarity-graph derivation over one memory table.
 * Snapshots publish atomically per workspace; a newer commit discards an in-flight computation.
 * @module @deepseek-ai/dsh-memory-local/graph
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryIdType, MemoryGraphStatus } from '@deepseek-ai/dsh-memory'
import { memoryStatusAt } from '@deepseek-ai/dsh-memory'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { LocalMemoryGraph, LocalMemoryRecord } from './spec.ts'
import type { OllamaSemanticIndex, SemanticEmbeddingApi } from './semantic.ts'

/** Version of the edge-derivation algorithm; persisted snapshots carry it. */
export const MEMORY_GRAPH_ALGORITHM_VERSION = 1 as const

/** Validated scheduling and edge policy for one derived workspace graph. */
export interface MemoryGraphConfig {
  readonly enabled: boolean
  readonly minScore: number
  readonly maxEdgesPerNode: number
  readonly maxGraphNodes: number
  readonly debounceMs: number
  readonly model: string
  readonly api: SemanticEmbeddingApi
}

/** Content-free observability for one completed or failed graph computation. */
export interface MemoryGraphEvent {
  readonly schemaVersion: 1
  readonly workspaceId: WorkspaceId
  readonly status: 'computed' | 'empty' | 'failed'
  readonly generation: number
  readonly nodeCount: number
  readonly edgeCount: number
  readonly embeddedCount: number
  readonly cacheHitCount: number
  readonly durationMs: number
  readonly failureCode?: string
}

/**
 * Schedule and publish derived similarity edges after memory commits.
 * Reads never trigger computation; `dirty` marks from successful writes do.
 */
export class MemoryGraphScheduler {
  private readonly pending = new Set<WorkspaceId>()
  private readonly generations = new Map<WorkspaceId, number>()
  private readonly inFlight = new Set<WorkspaceId>()
  private readonly controllers = new Set<AbortController>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  /**
   * @param graphTable - Workspace-keyed snapshot table inside the owning domain.
   * @param memories - Record table sharing the same domain and lifecycle.
   * @param index - Embedding index supplying pairwise cosine scores.
   * @param config - Validated bounds, threshold, model, and dialect.
   * @param emit - Content-free observability sink.
   */
  constructor(
    private readonly graphTable: KvTable<WorkspaceId, LocalMemoryGraph>,
    private readonly memories: KvTable<MemoryIdType, LocalMemoryRecord>,
    private readonly index: OllamaSemanticIndex,
    private readonly config: MemoryGraphConfig,
    private readonly emit: (event: Omit<MemoryGraphEvent, 'schemaVersion'>) => void,
  ) {}

  /**
   * Mark one workspace dirty after a committed create, correction, or forget.
   * Bumps the generation so any in-flight computation publishes nothing.
   * @param workspaceId - Scope whose snapshot is now stale.
   */
  dirty(workspaceId: WorkspaceId): void {
    if (this.disposed) return
    this.generations.set(workspaceId, (this.generations.get(workspaceId) ?? this.storedGeneration(workspaceId)) + 1)
    this.pending.add(workspaceId)
    this.schedule()
  }

  /**
   * Seed background computation for every workspace present at provider init.
   * Covers deployments whose records predate graph support; reads never schedule work.
   */
  seedExisting(): void {
    if (this.disposed) return
    for (const [, stored] of this.memories.entries()) {
      const workspaceId = stored.workspaceId
      if (this.pending.has(workspaceId)) continue
      this.generations.set(workspaceId, (this.generations.get(workspaceId) ?? this.storedGeneration(workspaceId)) + 1)
      this.pending.add(workspaceId)
    }
    if (this.pending.size > 0) this.schedule()
  }

  /**
   * Read the stored snapshot and derive its public status against current records.
   * @param workspaceId - Scope whose snapshot is requested.
   * @returns stored row plus derived `pending`/`stale` status, or `undefined` when never computed.
   */
  snapshot(workspaceId: WorkspaceId): { row: LocalMemoryGraph | undefined; status: MemoryGraphStatus } {
    const row = this.graphTable.get(workspaceId)
    if (row === undefined) return { row: undefined, status: 'pending' }
    if (row.status === 'failed') return { row, status: 'failed' }
    return { row, status: this.isStale(row) ? 'stale' : row.status }
  }

  /** Cancel the debounce and any in-flight computation; dirty marks after disposal are ignored. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const controller of this.controllers) controller.abort()
  }

  private schedule(): void {
    if (this.disposed || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.rebuildNext()
    }, this.config.debounceMs)
  }

  private async rebuildNext(): Promise<void> {
    const workspaceId = this.pending.values().next().value
    if (workspaceId === undefined || this.disposed) return
    this.pending.delete(workspaceId)
    if (this.inFlight.has(workspaceId)) {
      this.pending.add(workspaceId)
      this.schedule()
      return
    }
    this.inFlight.add(workspaceId)
    const generation = this.generations.get(workspaceId) ?? 0
    const controller = new AbortController()
    this.controllers.add(controller)
    const startedAt = Date.now()
    try {
      const { snapshot, embeddedCount, cacheHitCount } = await this.compute(
        workspaceId, generation, controller.signal,
      )
      this.publish(snapshot, generation)
      this.emit({
        workspaceId,
        status: snapshot.status,
        generation,
        nodeCount: Object.keys(snapshot.recordRevisions).length,
        edgeCount: snapshot.edges.length,
        embeddedCount,
        cacheHitCount,
        durationMs: Date.now() - startedAt,
        ...(snapshot.failureCode === undefined ? {} : { failureCode: snapshot.failureCode }),
      })
    } catch {
      if (!this.isDisposed() && !controller.signal.aborted) {
        const snapshot = this.failure(workspaceId, generation, startedAt)
        this.publish(snapshot, generation)
        this.emit({
          workspaceId,
          status: 'failed',
          generation,
          nodeCount: 0,
          edgeCount: 0,
          embeddedCount: 0,
          cacheHitCount: 0,
          durationMs: Date.now() - startedAt,
          failureCode: 'computation-failed',
        })
      }
    } finally {
      this.inFlight.delete(workspaceId)
      this.controllers.delete(controller)
      if (this.pending.size > 0) this.schedule()
    }
  }

  private async compute(
    workspaceId: WorkspaceId,
    generation: number,
    signal: AbortSignal,
  ): Promise<{ snapshot: LocalMemoryGraph; embeddedCount: number; cacheHitCount: number }> {
    const records = this.activeRecords(workspaceId)
    const recordRevisions = revisionsOf(records)
    const base = {
      workspaceId,
      generation,
      algorithmVersion: MEMORY_GRAPH_ALGORITHM_VERSION,
      model: this.config.model,
      api: this.config.api,
      minScore: this.config.minScore,
      maxEdgesPerNode: this.config.maxEdgesPerNode,
      computedAt: new Date().toISOString(),
      recordRevisions,
    }
    if (records.length > this.config.maxGraphNodes) {
      return {
        snapshot: { ...base, status: 'failed', edges: [], failureCode: 'graph-limit-exceeded' },
        embeddedCount: 0,
        cacheHitCount: 0,
      }
    }
    const linking = await this.index.link(
      records.map(([id, record]) => ({ id, revision: record.revision, content: record.content })),
      this.config.minScore,
      this.config.maxEdgesPerNode,
      signal,
    )
    return {
      snapshot: {
        ...base,
        status: linking.edges.length === 0 ? 'empty' : 'computed',
        edges: linking.edges.map(edge => ({
          a: { id: edge.a, revision: requiredRevision(recordRevisions, edge.a) },
          b: { id: edge.b, revision: requiredRevision(recordRevisions, edge.b) },
          score: edge.score,
          kind: 'semantic' as const,
        })),
      },
      embeddedCount: linking.embeddedCount,
      cacheHitCount: linking.cacheHitCount,
    }
  }

  /** Read disposal through a method so try/catch flow analysis cannot narrow the field away. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Atomically publish one snapshot; a newer dirty generation discards the write. */
  private publish(snapshot: LocalMemoryGraph, generation: number): void {
    if (this.disposed) return
    if ((this.generations.get(snapshot.workspaceId) ?? 0) > generation) return
    void this.graphTable.put(snapshot.workspaceId, snapshot)
  }

  private failure(workspaceId: WorkspaceId, generation: number, startedAt: number): LocalMemoryGraph {
    return {
      workspaceId,
      status: 'failed',
      generation,
      algorithmVersion: MEMORY_GRAPH_ALGORITHM_VERSION,
      model: this.config.model,
      api: this.config.api,
      minScore: this.config.minScore,
      maxEdgesPerNode: this.config.maxEdgesPerNode,
      computedAt: new Date(startedAt).toISOString(),
      recordRevisions: {},
      edges: [],
      failureCode: 'computation-failed',
    }
  }

  /** Active (not scheduled, superseded, or expired) records of one workspace, bounded by iteration. */
  private activeRecords(workspaceId: WorkspaceId): [MemoryIdType, LocalMemoryRecord][] {
    const now = Date.now()
    const records: [MemoryIdType, LocalMemoryRecord][] = []
    for (const [id, stored] of this.memories.entries()) {
      if (stored.workspaceId !== workspaceId) continue
      if (memoryStatusAt(stored, now) !== 'active') continue
      records.push([id, stored])
    }
    return records
  }

  /** One snapshot is stale when the current active revision set differs from its inputs. */
  private isStale(row: LocalMemoryGraph): boolean {
    if (this.generations.get(row.workspaceId) !== undefined
      && this.generations.get(row.workspaceId) !== row.generation) return true
    const current = revisionsOf(this.activeRecords(row.workspaceId))
    const recorded = row.recordRevisions
    const currentKeys = Object.keys(current)
    if (currentKeys.length !== Object.keys(recorded).length) return true
    return currentKeys.some(id => recorded[id] !== current[id])
  }

  private storedGeneration(workspaceId: WorkspaceId): number {
    return this.graphTable.get(workspaceId)?.generation ?? 0
  }
}

function revisionsOf(records: readonly [MemoryIdType, LocalMemoryRecord][]): Record<string, number> {
  const revisions: Record<string, number> = {}
  for (const [id, record] of records) revisions[String(id)] = record.revision
  return revisions
}

function requiredRevision(revisions: Record<string, number>, id: MemoryIdType): number {
  const revision = revisions[String(id)]
  /* v8 ignore next -- edges derive from the same active set. */
  if (revision === undefined) throw new Error('memory graph: edge references a missing revision')
  return revision
}
