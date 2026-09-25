/**
 * Bounded, service-scheduled similarity-graph derivation over one memory table.
 * Snapshots publish atomically per workspace; obsolete computations are discarded at the write queue slot.
 * @module @deepseek-ai/dsh-memory-local/graph
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryIdType, MemoryGraphStatus } from '@deepseek-ai/dsh-memory'
import { memoryStatusAt } from '@deepseek-ai/dsh-memory'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { LocalMemoryGraph, LocalMemoryRecord, LocalMemoryVersion } from './spec.ts'
import type { OllamaSemanticIndex, SemanticEmbeddingApi } from './semantic.ts'
import { SemanticSearchError } from './semantic.ts'

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
  readonly historyMode?: 'v1' | 'temporal-v2'
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
  private running: Promise<void> | undefined
  private operation: { workspaceId: WorkspaceId; controller: AbortController } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private transitionTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private enabled: boolean

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
    private readonly emit: (event: Omit<MemoryGraphEvent, 'schemaVersion'>) => void | Promise<void>,
  ) {
    this.enabled = config.enabled
  }

  /**
   * Mark one workspace dirty after a committed create, correction, or forget.
   * Bumps the generation so any in-flight computation publishes nothing.
   * @param workspaceId - Scope whose snapshot is now stale.
   */
  dirty(workspaceId: WorkspaceId): void {
    if (this.disposed || !this.enabled) return
    this.generations.set(workspaceId, (this.generations.get(workspaceId) ?? this.storedGeneration(workspaceId)) + 1)
    this.pending.add(workspaceId)
    this.schedule()
    this.scheduleTransitions()
  }

  /**
   * Seed every stored memory or graph scope, including scopes emptied before a prior shutdown.
   * Also schedules future validity boundaries; reads never schedule work.
   */
  seedExisting(): void {
    if (this.disposed || !this.enabled) return
    const workspaces = new Set<WorkspaceId>()
    for (const [, stored] of this.memories.entries()) workspaces.add(stored.workspaceId)
    for (const [workspaceId] of this.graphTable.entries()) workspaces.add(workspaceId)
    for (const workspaceId of workspaces) {
      if (this.pending.has(workspaceId)) continue
      this.generations.set(workspaceId, (this.generations.get(workspaceId) ?? this.storedGeneration(workspaceId)) + 1)
      this.pending.add(workspaceId)
    }
    if (this.pending.size > 0) this.schedule()
    this.scheduleTransitions()
  }

  /**
   * Read the stored snapshot and derive its public status against current records.
   * @param workspaceId - Scope whose snapshot is requested.
   * @returns Stored row and derived status; an idle scope without active records is empty even before its first computation.
   */
  snapshot(workspaceId: WorkspaceId): { row: LocalMemoryGraph | undefined; status: MemoryGraphStatus } {
    if (!this.enabled) return { row: undefined, status: 'unavailable' }
    const row = this.graphTable.get(workspaceId)
    if (row === undefined) {
      const pending = this.pending.has(workspaceId) || this.operation?.workspaceId === workspaceId
        || this.activeRecords(workspaceId, 1).length > 0
      return { row: undefined, status: pending ? 'pending' : 'empty' }
    }
    if (row.status === 'failed') return { row, status: 'failed' }
    return { row, status: this.isStale(row) ? 'stale' : row.status }
  }

  /**
   * Cancel timers and inference, suppress notifications, and drain any submitted durable write.
   * @returns Resolution after background work has reached quiescence; close the domain afterwards.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.transitionTimer !== undefined) clearTimeout(this.transitionTimer)
    this.pending.clear()
    this.operation?.controller.abort()
    await this.running
  }

  /**
   * Apply the host's opt-in state without permitting disabled work to publish.
   * @param enabled - Whether this memory scope may perform background embedding work.
   * @returns Resolution after disabling has drained already-submitted work; enabling seeds known scopes.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return
    if (this.enabled === enabled) {
      if (!enabled) await this.running
      return
    }
    this.enabled = enabled
    if (enabled) {
      this.seedExisting()
      return
    }
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.transitionTimer !== undefined) clearTimeout(this.transitionTimer)
    this.timer = undefined
    this.transitionTimer = undefined
    this.pending.clear()
    this.operation?.controller.abort()
    await this.running
  }

  private schedule(): void {
    if (this.disposed || !this.enabled || this.timer !== undefined || this.running !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.running = this.rebuildNext().finally(() => {
        this.running = undefined
        if (!this.disposed && this.pending.size > 0) this.schedule()
      })
    }, this.config.debounceMs)
  }

  private async rebuildNext(): Promise<void> {
    const workspaceId = this.pending.values().next().value
    if (workspaceId === undefined || this.disposed || !this.enabled) return
    this.pending.delete(workspaceId)
    const generation = this.generations.get(workspaceId) ?? 0
    const controller = new AbortController()
    this.operation = { workspaceId, controller }
    const startedAt = Date.now()
    try {
      const { snapshot, embeddedCount, cacheHitCount } = await this.compute(
        workspaceId, generation, controller.signal,
      )
      if (!await this.publish(snapshot, generation)) return
      await this.notify({
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
    } catch (error) {
      if (!this.isDisposed() && !controller.signal.aborted) {
        const failureCode = error instanceof SemanticSearchError ? error.code : 'computation-failed'
        const snapshot = this.failure(workspaceId, generation, startedAt, failureCode)
        if (!await this.publish(snapshot, generation)) return
        await this.notify({
          workspaceId,
          status: 'failed',
          generation,
          nodeCount: 0,
          edgeCount: 0,
          embeddedCount: 0,
          cacheHitCount: 0,
          durationMs: Date.now() - startedAt,
          failureCode,
        })
      }
    } finally {
      this.operation = undefined
    }
  }

  private async compute(
    workspaceId: WorkspaceId,
    generation: number,
    signal: AbortSignal,
  ): Promise<{ snapshot: LocalMemoryGraph; embeddedCount: number; cacheHitCount: number }> {
    const records = this.activeRecords(workspaceId, this.config.maxGraphNodes + 1)
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
        snapshot: { ...base, recordRevisions: {}, status: 'failed', edges: [], failureCode: 'graph-limit-exceeded' },
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

  /** Check scope inputs at the domain write slot and notify only after durable publication. */
  private async publish(snapshot: LocalMemoryGraph, generation: number): Promise<boolean> {
    if (this.disposed || !this.enabled || this.generations.get(snapshot.workspaceId) !== generation) return false
    try {
      const published = await this.graphTable.mutate(snapshot.workspaceId, () => {
        if (!this.canPublish(snapshot, generation)) return { kind: 'keep', result: false }
        return { kind: 'put', value: snapshot, result: true }
      })
      const current = this.canPublish(snapshot, generation)
      if (!current && !this.isDisposed() && this.generations.get(snapshot.workspaceId) === generation) {
        this.dirty(snapshot.workspaceId)
      }
      return published && current
    } catch {
      // Backend rejection has no durable result: report a sanitized operational failure only.
      if (!this.isDisposed() && this.generations.get(snapshot.workspaceId) === generation) {
        await this.notify({
          workspaceId: snapshot.workspaceId, status: 'failed', generation,
          nodeCount: 0, edgeCount: 0, embeddedCount: 0, cacheHitCount: 0,
          durationMs: 0, failureCode: 'persistence-failed',
        })
      }
      return false
    }
  }

  private canPublish(snapshot: LocalMemoryGraph, generation: number): boolean {
    if (this.disposed || !this.enabled || this.generations.get(snapshot.workspaceId) !== generation) return false
    return snapshot.status === 'failed' || !this.isStale(snapshot)
  }

  private async notify(event: Omit<MemoryGraphEvent, 'schemaVersion'>): Promise<void> {
    if (this.disposed || !this.enabled) return
    try {
      await this.emit(event)
    } catch {
      // The observer owns its failure; it must not invalidate committed graphs or retry computation.
    }
  }

  private failure(workspaceId: WorkspaceId, generation: number, startedAt: number, failureCode: string): LocalMemoryGraph {
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
      failureCode,
    }
  }

  /** Retain at most the graph limit plus one active revision per id to detect overflow. */
  private activeRecords(workspaceId: WorkspaceId, limit = this.config.maxGraphNodes + 1): [MemoryIdType, LocalMemoryVersion][] {
    const now = Date.now()
    const records: [MemoryIdType, LocalMemoryVersion][] = []
    for (const [id, stored] of this.memories.entries()) {
      if (stored.workspaceId !== workspaceId) continue
      const active = activeGraphMemoryVersion(stored, this.config.historyMode ?? 'temporal-v2', now)
      if (active === undefined) continue
      records.push([id, active])
      if (records.length >= limit) break
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

  /** Temporal boundaries dirty their scopes independently of reads or successful embedding requests. */
  private scheduleTransitions(): void {
    if (this.transitionTimer !== undefined) clearTimeout(this.transitionTimer)
    this.transitionTimer = undefined
    if (this.disposed || !this.enabled) return
    const now = Date.now()
    const transitions = new Map<WorkspaceId, number>()
    for (const [, stored] of this.memories.entries()) {
      const versions = this.config.historyMode === 'v1' ? [stored] : [stored, ...(stored.history ?? [])]
      for (const version of versions) {
        for (const value of [version.validFrom, version.validUntil, version.expiresAt]) {
          const at = value === undefined ? Number.NaN : Date.parse(value)
          if (!Number.isFinite(at) || at <= now) continue
          transitions.set(stored.workspaceId, Math.min(transitions.get(stored.workspaceId) ?? at, at))
        }
      }
    }
    if (transitions.size === 0) return
    let next = Number.POSITIVE_INFINITY
    for (const at of transitions.values()) next = Math.min(next, at)
    // Node timer delays are signed 32-bit milliseconds; long deadlines are re-armed without dirtying.
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = undefined
      if (this.disposed) return
      for (const [workspaceId, at] of transitions) {
        if (at <= Date.now()) this.dirty(workspaceId)
      }
      this.scheduleTransitions()
    }, Math.min(next - now, 2_147_483_647))
    this.transitionTimer.unref()
  }
}

/**
 * Select the newest currently active revision of a lineage, honoring the provider's history mode.
 * @param stored - Persisted current revision and optional historical revisions.
 * @param historyMode - Whether temporal history participates in retrieval.
 * @param now - Epoch milliseconds at which validity is evaluated.
 * @returns An active revision, or undefined when every revision is inactive or temporally invalid.
 */
export function activeGraphMemoryVersion(
  stored: LocalMemoryRecord,
  historyMode: 'v1' | 'temporal-v2',
  now: number,
): LocalMemoryVersion | undefined {
  const versions = historyMode === 'v1' ? [stored] : [stored, ...(stored.history ?? [])]
  let active: LocalMemoryVersion | undefined
  for (const version of versions) {
    const times = [version.validFrom, version.validUntil, version.expiresAt]
    if (times.some(value => value !== undefined && !Number.isFinite(Date.parse(value)))) continue
    if (version.validFrom !== undefined && version.validUntil !== undefined
      && Date.parse(version.validUntil) < Date.parse(version.validFrom)) continue
    if (version.validFrom !== undefined && version.expiresAt !== undefined
      && Date.parse(version.expiresAt) <= Date.parse(version.validFrom)) continue
    if ([version.supersedes, version.supersededBy].some(ref => ref !== undefined
      && (String(ref.id).length === 0 || !Number.isSafeInteger(ref.revision) || ref.revision <= 0))) continue
    if (memoryStatusAt(version, now) !== 'active') continue
    if (active === undefined || version.revision > active.revision) active = version
  }
  return active
}

function revisionsOf(records: readonly [MemoryIdType, LocalMemoryVersion][]): Record<string, number> {
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
