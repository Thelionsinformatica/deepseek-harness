/**
 * Host-side Remote service for workspace-isolated memory candidate review.
 * @module @deepseek-ai/dsh-tool-memory/review
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { memoryCandidateDomainSpec, type MemoryCandidateRecord } from './spec.ts'
import type {
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
  static inject = ['storageDomain', 'sessionPersistence', 'sessions', 'workspaceRegistry']

  /** Loader validation for the stable local reviewer label. */
  static Config: s<Config> = s.object({ reviewedBy: s.string().required() })

  private table?: KvTable<MemoryCandidateId, MemoryCandidateRecord>
  private readonly operationTails = new Map<MemoryCandidateId, Promise<void>>()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - host context carrying Session, workspace, and storage services.
   * @param config - deployment-owned reviewer identity.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memoryCandidateReview')
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
   * Record one immutable human decision without writing to `ctx.memory`.
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
      const reviewed = Object.freeze({
        ...current,
        reviewed: true,
        reviewDecision: request.decision,
        reviewedAt: new Date().toISOString(),
        reviewedBy: this.config.reviewedBy,
      }) satisfies MemoryCandidateRecord
      await table.put(request.id, reviewed)
      return success({ item: projectCandidate(reviewed) })
    })
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
    createdAt: row.createdAt,
  })
}

/** Clamp one optional integer input to a safe closed interval. */
function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export default MemoryCandidateReviewService
