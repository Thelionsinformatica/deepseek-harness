/**
 * Host-side Remote service for workspace-isolated memory candidate review.
 * @module @deepseek-ai/dsh-tool-memory/review
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { MemoryRecord } from '@deepseek-ai/dsh-memory'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { memoryCandidateDomainSpec, type MemoryCandidateRecord } from './spec.ts'
import { looksSensitive } from './sensitivity.ts'
import type {
  MemoryCandidateAutoWriteReason,
  MemoryCandidateAutoWriteTrace,
  MemoryCandidateId,
  MemoryCandidateReviewFailure,
  MemoryCandidateReviewItem,
  MemoryCandidateReviewListRequest,
  MemoryCandidateReviewListResult,
  MemoryCandidateReviewMarkRequest,
  MemoryCandidateReviewMarkResult,
} from './types.ts'

/** Deployment-owned reviewer identity written to every human decision. */
export interface Config {
  readonly reviewedBy: string
  /** Master kill switch; acceptance never writes when false or omitted. */
  readonly automaticWrite?: boolean
  /** Exact workspace ids allowed to persist reviewed candidates. */
  readonly automaticWriteWorkspaceIds?: string[]
  /** Exact local owner ids allowed to persist reviewed candidates. */
  readonly automaticWriteUserIds?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryCandidateReview: MemoryCandidateReviewService
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Host service exposing only projected candidate rows through the generated Remote. */
export class MemoryCandidateReviewService extends TypertRemoteService {
  static inject = ['memory', 'storageDomain', 'sessionPersistence', 'sessions', 'workspaceRegistry']

  /** Loader validation for the stable local reviewer label. */
  static Config: s<Config> = s.object({
    reviewedBy: s.string().required(),
    automaticWrite: s.boolean(),
    automaticWriteWorkspaceIds: s.array(s.string()),
    automaticWriteUserIds: s.array(s.string()),
  })

  private table?: KvTable<MemoryCandidateId, MemoryCandidateRecord>
  private readonly operationTails = new Map<MemoryCandidateId, Promise<void>>()
  private mutationAdmissionOpen = true
  private readonly automaticWriteWorkspaceIds: ReadonlySet<string>
  private readonly automaticWriteUserIds: ReadonlySet<string>

  /**
   * @param ctx - host context carrying Session, workspace, and storage services.
   * @param config - deployment-owned reviewer identity.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memoryCandidateReview')
    this.automaticWriteWorkspaceIds = normalizedFlagSet(config.automaticWriteWorkspaceIds, 'workspace')
    this.automaticWriteUserIds = normalizedFlagSet(config.automaticWriteUserIds, 'user')
  }

  /** Open and own the candidate review domain for this Host service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryCandidateDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await domain.close()
    }, 'memory-candidate-review.domainClose')
    this.table = domain.table('candidates')
  }

  /**
   * Append one producer-owned candidate into the canonical queue.
   * This host-only method is intentionally not exposed as a browser Remote.
   * @param record - complete validated candidate row with a unique id.
   */
  async recordCandidate(record: MemoryCandidateRecord): Promise<void> {
    await this.requireTable().put(record.id, record)
  }

  /**
   * List one workspace partition, using the addressed Session as authorization anchor.
   * @param request - session anchor, filters, and bounded page coordinates.
   * @returns projected rows or an explicit ownership failure.
   */
  @Remote('list')
  async list(request: MemoryCandidateReviewListRequest): Promise<MemoryCandidateReviewListResult> {
    const workspace = await this.resolveWorkspace(request.sessionId)
    if (!workspace.ok) return workspace
    const offset = clampInteger(request.offset, 0, Number.MAX_SAFE_INTEGER, 0)
    const limit = clampInteger(request.limit, 1, MAX_LIMIT, DEFAULT_LIMIT)
    const matching = [...this.requireTable().entries()]
      .map(([, row]) => row)
      .filter(row => row.workspaceId === workspace.value)
      .filter(row => request.reviewed === undefined || row.reviewed === request.reviewed)
      .filter(row => request.reviewDecision === undefined || row.reviewDecision === request.reviewDecision)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || String(right.id).localeCompare(String(left.id)))
    const page = matching.slice(offset, offset + limit).map(projectCandidate)
    return success({
      items: Object.freeze(page),
      hasMore: offset + page.length < matching.length,
      nextOffset: offset + page.length,
    })
  }

  /**
   * Record one immutable human decision and optionally persist an authorized candidate.
   * @param request - session authorization anchor, candidate id, and decision.
   * @returns the reviewed projection or an explicit business failure.
   */
  @Remote('markReviewed')
  markReviewed(request: MemoryCandidateReviewMarkRequest): Promise<MemoryCandidateReviewMarkResult> {
    return this.enqueue(request.id, async () => {
      const workspace = await this.resolveWorkspace(request.sessionId)
      if (!workspace.ok) return workspace
      const table = this.requireTable()
      const current = table.get(request.id)
      if (current === undefined) return rejected({ code: 'memory-candidate-not-found', id: request.id })
      if (current.workspaceId !== workspace.value) {
        return rejected({ code: 'memory-candidate-workspace-mismatch', id: request.id })
      }
      if (current.reviewed) {
        if (current.reviewDecision === request.decision) return success({ item: projectCandidate(current) })
        return rejected({ code: 'memory-candidate-already-reviewed', current: projectCandidate(current) })
      }
      if (request.decision === 'accept'
        && (current.candidateContent === undefined
          || current.sensitivity === 'blocked'
          || current.policyDecision === 'block'
          || current.policyDecision === 'reject')) {
        return rejected({ code: 'memory-candidate-not-acceptable', id: request.id })
      }
      const reviewedAt = new Date().toISOString()
      const autoWrite = await this.applyAutomaticWrite(table, current, workspace.value, request.decision)
      if (!autoWrite.ok) return autoWrite
      const reviewed = Object.freeze({
        ...autoWrite.value,
        reviewed: true,
        reviewDecision: request.decision,
        reviewedAt,
        reviewedBy: this.config.reviewedBy,
      }) satisfies MemoryCandidateRecord
      await table.put(request.id, reviewed)
      return success({ item: projectCandidate(reviewed) })
    })
  }

  /** Apply the reviewed-write feature flags and persist an auditable decision trace. */
  private async applyAutomaticWrite(
    table: KvTable<MemoryCandidateId, MemoryCandidateRecord>,
    current: MemoryCandidateRecord,
    workspaceId: WorkspaceId,
    decision: MemoryCandidateReviewMarkRequest['decision'],
  ): Promise<
    | { readonly ok: true; readonly value: MemoryCandidateRecord }
    | { readonly ok: false; readonly error: MemoryCandidateReviewFailure }
  > {
    if (current.autoWrite?.status === 'stored') return success(current)
    if (current.autoWrite?.status === 'writing') {
      this.ctx.logger.error(
        'memory-candidate-review: candidate %s has an uncertain prior write; refusing a duplicate',
        current.id,
      )
      return rejected({ code: 'memory-candidate-auto-write-failed', id: current.id })
    }
    const skippedReason = this.autoWriteSkipReason(current, workspaceId, decision)
    if (skippedReason !== undefined) {
      return success(withAutoWrite(current, 'skipped', skippedReason))
    }
    const writing = withAutoWrite(current, 'writing', 'write-started')
    await table.put(current.id, writing)
    const content = current.candidateContent
    if (content === undefined || looksSensitive(content)) {
      await table.put(current.id, withAutoWrite(current, 'failed', 'provider-failed'))
      return rejected({ code: 'memory-candidate-auto-write-failed', id: current.id })
    }
    let stored: MemoryRecord
    try {
      stored = await this.ctx.memory.create({
        scope: { workspaceId },
        content,
        source: { kind: 'session', sessionId: current.sessionId },
        ...(current.importance === undefined ? {} : { importance: current.importance }),
        confidence: current.confidence,
        validation: 'reviewed',
      })
    } catch (error: unknown) {
      await table.put(current.id, withAutoWrite(current, 'failed', 'provider-failed'))
      this.ctx.logger.warn(
        'memory-candidate-review: approved automatic write failed; candidate remains retryable: %o',
        error,
      )
      return rejected({ code: 'memory-candidate-auto-write-failed', id: current.id })
    }
    const storedCandidate = withAutoWrite(current, 'stored', 'approved-and-authorized', {
      memoryId: stored.id,
      revision: stored.revision,
    })
    try {
      await table.put(current.id, storedCandidate)
    } catch (error: unknown) {
      this.ctx.logger.error(
        'memory-candidate-review: memory was stored but its journal finalization failed; refusing automatic retry: %o',
        error,
      )
      return rejected({ code: 'memory-candidate-auto-write-failed', id: current.id })
    }
    return success(storedCandidate)
  }

  /** Return why a review cannot enter the automatic-write path, or none when authorized. */
  private autoWriteSkipReason(
    current: MemoryCandidateRecord,
    workspaceId: WorkspaceId,
    decision: MemoryCandidateReviewMarkRequest['decision'],
  ): MemoryCandidateAutoWriteReason | undefined {
    if (decision === 'reject') return 'human-rejected'
    if (decision === 'ignore') return 'human-ignored'
    if (this.config.automaticWrite !== true) return 'feature-disabled'
    if (!this.automaticWriteWorkspaceIds.has(workspaceId)) return 'workspace-not-enabled'
    if (current.userId === undefined || !this.automaticWriteUserIds.has(current.userId)) return 'user-not-enabled'
    if (current.policyDecision !== 'store'
      || current.sensitivity !== 'none'
      || current.candidateContent === undefined) return 'policy-not-eligible'
    return undefined
  }

  /** Resolve a live or persisted Session to its registered workspace partition. */
  private async resolveWorkspace(sessionId: SessionId): Promise<
    | { readonly ok: true; readonly value: WorkspaceId }
    | { readonly ok: false; readonly error: MemoryCandidateReviewFailure }
  > {
    let header: SessionHeader | undefined = this.ctx.sessions.get(sessionId)?.header
    if (header === undefined) {
      const snapshot = (await this.ctx.sessionPersistence.listSnapshots())
        .find(entry => entry.header.id === sessionId)
      if (snapshot === undefined) {
        return rejected({ code: 'memory-review-session-not-found', sessionId })
      }
      header = snapshot.header
    }
    const cwd = header.cwd
    if (cwd === undefined) {
      return rejected({ code: 'memory-review-workspace-unavailable', sessionId })
    }
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) {
      return rejected({ code: 'memory-review-workspace-unavailable', sessionId })
    }
    return success(workspace.id)
  }

  /** Serialize review writes per candidate so two local tabs cannot replace each other. */
  private enqueue<T>(id: MemoryCandidateId, operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('memory-candidate-review: service is disposing'))
    const previous = this.operationTails.get(id) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(id, tail)
    return result.finally(() => {
      if (this.operationTails.get(id) === tail) this.operationTails.delete(id)
    })
  }

  /** Require the initialized durable candidate table. */
  private requireTable(): KvTable<MemoryCandidateId, MemoryCandidateRecord> {
    if (this.table === undefined) throw new Error('memory-candidate-review: durable domain is not initialized')
    return this.table
  }
}

/** Return a frozen success branch. */
function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return Object.freeze({ ok: true, value: Object.freeze(value) })
}

/** Return a frozen business-failure branch. */
function rejected<E extends MemoryCandidateReviewFailure>(error: E): { readonly ok: false; readonly error: E } {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Copy one row into the browser-safe projection. */
function projectCandidate(row: MemoryCandidateRecord): MemoryCandidateReviewItem {
  return Object.freeze({
    id: row.id,
    sessionId: row.sessionId,
    operation: row.operation,
    ...(row.candidateContent === undefined ? {} : { candidateContent: row.candidateContent }),
    ...(row.category === undefined ? {} : { category: row.category }),
    confidence: row.confidence,
    ...(row.importance === undefined ? {} : { importance: row.importance }),
    ...(row.sensitivity === undefined ? {} : { sensitivity: row.sensitivity }),
    policyVersion: row.policyVersion,
    policyDecision: row.policyDecision,
    policyReason: row.policyReason,
    reviewed: row.reviewed,
    ...(row.reviewDecision === undefined ? {} : { reviewDecision: row.reviewDecision }),
    ...(row.reviewedAt === undefined ? {} : { reviewedAt: row.reviewedAt }),
    ...(row.reviewedBy === undefined ? {} : { reviewedBy: row.reviewedBy }),
    ...(row.autoWrite === undefined ? {} : { autoWrite: row.autoWrite }),
    createdAt: row.createdAt,
  })
}

/** Return one frozen row carrying the latest controlled-write journal state. */
function withAutoWrite(
  current: MemoryCandidateRecord,
  status: MemoryCandidateAutoWriteTrace['status'],
  reason: MemoryCandidateAutoWriteReason,
  stored: Pick<MemoryCandidateAutoWriteTrace, 'memoryId' | 'revision'> = {},
): MemoryCandidateRecord {
  return Object.freeze({
    ...current,
    autoWrite: Object.freeze({
      status,
      reason,
      recordedAt: new Date().toISOString(),
      ...(stored.memoryId === undefined ? {} : { memoryId: stored.memoryId }),
      ...(stored.revision === undefined ? {} : { revision: stored.revision }),
    }),
  })
}

/** Normalize one exact-match feature-flag list and reject ambiguous empty values. */
function normalizedFlagSet(values: readonly string[] | undefined, label: string): ReadonlySet<string> {
  const normalized = (values ?? []).map(value => value.trim())
  if (normalized.some(value => value.length === 0 || value.length > 256)) {
    throw new TypeError(`memory-candidate-review: automatic-write ${label} ids must contain 1-256 characters`)
  }
  return new Set(normalized)
}

/** Clamp one optional integer input to a safe closed interval. */
function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export default MemoryCandidateReviewService
