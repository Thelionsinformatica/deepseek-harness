/**
 * Host-side Remote service for workspace-isolated memory candidate review.
 * @module @deepseek-ai/dsh-tool-memory/review
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  memoryStatusAt,
  type MemoryListRequest,
  type MemoryRecord,
  type MemoryStatus,
} from '@deepseek-ai/dsh-memory'
import {
  PersonalMemoryOwnerId,
  type PersonalMemoryOwnerIdentity,
  type PersonalMemoryRecord,
  type PersonalMemoryRuntime,
} from '@deepseek-ai/dsh-personal-memory'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  memoryAdminDomainSpec,
  memoryCandidateDomainSpec,
  personalMemoryAdminDomainSpec,
  type MemoryAdminActionRecord,
  type MemoryCandidateRecord,
  type PersonalMemoryAdminActionRecord,
} from './spec.ts'
import { looksSensitive } from './sensitivity.ts'
import {
  MemoryAdminActionId,
  type MemoryAdminCorrectRequest,
  type MemoryAdminCorrectResult,
  type MemoryAdminFailure,
  type MemoryAdminForgetRequest,
  type MemoryAdminForgetResult,
  type MemoryAdminItem,
  type MemoryAdminListRequest,
  type MemoryAdminListResult,
  type MemoryAdminListValue,
  type MemoryCandidateAutoWriteReason,
  type MemoryCandidateAutoWriteTrace,
  type MemoryCandidateId,
  type MemoryCandidateReviewFailure,
  type MemoryCandidateReviewItem,
  type MemoryCandidateReviewListRequest,
  type MemoryCandidateReviewListResult,
  type MemoryCandidateReviewMarkRequest,
  type MemoryCandidateReviewMarkResult,
  type PersonalMemoryAdminListResult,
  type PersonalMemoryAdminRememberRequest,
  type PersonalMemoryAdminRememberResult,
  type PersonalMemoryAdminToggleRequest,
  type PersonalMemoryAdminToggleResult,
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
  /** Administrative mutation switch; `read-only` is the emergency rollback. */
  readonly administrationMode?: 'read-only' | 'full'
  /** Stable local-owner partition exposed through the personal-memory panel. */
  readonly personalOwnerId?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryCandidateReview: MemoryCandidateReviewService
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const PERSONAL_MEMORY_SETTINGS_NAMESPACE = settingsNamespace('personal-memory')

interface PersonalMemorySettings {
  readonly enabled: boolean
}

type MemoryAdminRejected = { readonly ok: false; readonly error: MemoryAdminFailure }

interface PersonalMutationRequest {
  readonly sessionId: SessionId
  readonly confirmed: boolean
}

interface PersonalCapabilityValue {
  readonly runtime: PersonalMemoryRuntime
  readonly settings: SettingsScope<PersonalMemorySettings>
  readonly scope: { readonly ownerId: PersonalMemoryOwnerIdentity }
}

interface ProjectableMemoryPage {
  readonly items: readonly {
    readonly record: MemoryRecord | PersonalMemoryRecord
    readonly status: MemoryStatus
  }[]
  readonly hasMore: boolean
  readonly nextOffset: number
}

const PersonalMemorySettingsSchema: s<PersonalMemorySettings> = s.object({
  enabled: s.boolean().default(true),
})

/** Host service exposing only projected candidate rows through the generated Remote. */
export class MemoryCandidateReviewService extends TypertRemoteService {
  static inject = ['memory', 'storageDomain', 'sessionPersistence', 'sessions', 'workspaceRegistry']

  /** Loader validation for the stable local reviewer label. */
  static Config: s<Config> = s.object({
    reviewedBy: s.string().required(),
    automaticWrite: s.boolean(),
    automaticWriteWorkspaceIds: s.array(s.string()),
    automaticWriteUserIds: s.array(s.string()),
    administrationMode: s.union(['read-only', 'full'] as const).default('read-only'),
    personalOwnerId: s.string(),
  })

  private table?: KvTable<MemoryCandidateId, MemoryCandidateRecord>
  private adminTable?: KvTable<MemoryAdminActionId, MemoryAdminActionRecord>
  private personalAdminTable?: KvTable<MemoryAdminActionId, PersonalMemoryAdminActionRecord>
  private personalRuntime: PersonalMemoryRuntime | undefined
  private personalSettings: SettingsScope<PersonalMemorySettings> | undefined
  private readonly personalOwnerId: PersonalMemoryOwnerIdentity | undefined
  private readonly operationTails = new Map<string, Promise<void>>()
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
    this.personalOwnerId = normalizedPersonalOwnerId(config.personalOwnerId)
    if (this.personalOwnerId !== undefined) {
      ctx.inject(['personalMemory', 'settings'], (personalCtx) => {
        const settings = personalCtx.settings.register(
          PERSONAL_MEMORY_SETTINGS_NAMESPACE,
          PersonalMemorySettingsSchema,
        )
        const runtime = personalCtx.personalMemory
        this.personalRuntime = runtime
        this.personalSettings = settings
        runtime.setEnabled(settings.get().enabled)
        const stopWatching = settings.watch((next) => { runtime.setEnabled(next.enabled) })
        personalCtx.effect(() => () => {
          stopWatching()
          if (this.personalSettings === settings) this.personalSettings = undefined
          if (this.personalRuntime === runtime) this.personalRuntime = undefined
        }, 'memory-candidate-review.personalMemorySettings')
      })
    }
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
    const adminDomain = await this.ctx.storageDomain.open(memoryAdminDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await adminDomain.close()
    }, 'memory-candidate-review.adminDomainClose')
    this.adminTable = adminDomain.table('actions')
    const personalAdminDomain = await this.ctx.storageDomain.open(personalMemoryAdminDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await personalAdminDomain.close()
    }, 'memory-candidate-review.personalAdminDomainClose')
    this.personalAdminTable = personalAdminDomain.table('actions')
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
   * List durable memories for the addressed Session's exact workspace partition.
   * @param request - Session authorization anchor, lifecycle filters, and bounded page coordinates.
   * @returns Browser-safe workspace rows or an explicit administrative failure.
   */
  @Remote('listMemories')
  async listMemories(request: MemoryAdminListRequest): Promise<MemoryAdminListResult> {
    const workspace = await this.resolveWorkspace(request.sessionId)
    if (!workspace.ok) return workspace
    const options = normalizedMemoryListOptions(request)
    if (!options.ok) {
      return rejected({ code: 'memory-admin-operation-failed', action: 'list' })
    }
    try {
      const page = await this.ctx.memory.list({
        scope: { workspaceId: workspace.value },
        ...options.value,
      })
      return success({
        ...projectMemoryPage(page),
        readOnly: this.config.administrationMode !== 'full',
      })
    } catch (error: unknown) {
      this.ctx.logger.warn('memory-candidate-review: administrative list failed: %o', error)
      return rejected({ code: 'memory-admin-operation-failed', action: 'list' })
    }
  }

  /**
   * Correct one exact memory revision after explicit operator confirmation.
   * @param request - Session anchor, exact memory revision, replacement content, and confirmation.
   * @returns The corrected browser-safe row and audit id, or an explicit failure.
   */
  @Remote('correctMemory')
  correctMemory(request: MemoryAdminCorrectRequest): Promise<MemoryAdminCorrectResult> {
    return this.enqueue(String(request.id), async () => {
      const admission = this.checkAdminMutation(request.confirmed)
      if (admission !== undefined) return admission
      const workspace = await this.resolveWorkspace(request.sessionId)
      if (!workspace.ok) return workspace
      const content = request.content.trim()
      if (looksSensitive(content)) return adminRejected({ code: 'memory-admin-sensitive-content' })
      let audit: MemoryAdminActionRecord
      try {
        audit = await this.beginAdminAction(
          workspace.value,
          request.sessionId,
          request.id,
          request.revision,
          'correct',
        )
      } catch (error: unknown) {
        this.ctx.logger.error('memory-candidate-review: administrative audit admission failed: %o', error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'correct' })
      }
      try {
        const updated = await this.ctx.memory.update({
          scope: { workspaceId: workspace.value },
          ref: { id: request.id, revision: request.revision },
          content,
          source: { kind: 'session', sessionId: request.sessionId },
        })
        await this.finishAdminAction(audit, 'succeeded', updated.revision)
        return success({
          item: projectMemory(updated, memoryStatusAt(updated)),
          auditId: audit.id,
        })
      } catch (error: unknown) {
        await this.failAdminAction(audit, error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'correct', auditId: audit.id })
      }
    })
  }

  /**
   * Forget one exact memory lineage after explicit operator confirmation.
   * @param request - Session anchor, exact memory revision, and confirmation.
   * @returns The forgotten reference and audit id, or an explicit failure.
   */
  @Remote('forgetMemory')
  forgetMemory(request: MemoryAdminForgetRequest): Promise<MemoryAdminForgetResult> {
    return this.enqueue(String(request.id), async () => {
      const admission = this.checkAdminMutation(request.confirmed)
      if (admission !== undefined) return admission
      const workspace = await this.resolveWorkspace(request.sessionId)
      if (!workspace.ok) return workspace
      let audit: MemoryAdminActionRecord
      try {
        audit = await this.beginAdminAction(
          workspace.value,
          request.sessionId,
          request.id,
          request.revision,
          'forget',
        )
      } catch (error: unknown) {
        this.ctx.logger.error('memory-candidate-review: administrative audit admission failed: %o', error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'forget' })
      }
      try {
        await this.ctx.memory.forget({
          scope: { workspaceId: workspace.value },
          ref: { id: request.id, revision: request.revision },
        })
        await this.finishAdminAction(audit, 'succeeded')
        return success({ id: request.id, revision: request.revision, auditId: audit.id })
      } catch (error: unknown) {
        await this.failAdminAction(audit, error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'forget', auditId: audit.id })
      }
    })
  }

  /**
   * List the configured local owner's personal memories without exposing the owner id.
   * @param request - Session authorization anchor and bounded list filters.
   * @returns Browser-safe personal rows plus the current enablement state, or an explicit failure.
   */
  @Remote('listPersonalMemories')
  async listPersonalMemories(request: MemoryAdminListRequest): Promise<PersonalMemoryAdminListResult> {
    const session = await this.resolveSession(request.sessionId)
    if (!session.ok) return session
    const personal = this.personalCapability()
    if (!personal.ok) return personal
    const options = normalizedMemoryListOptions(request)
    if (!options.ok) {
      return rejected({ code: 'memory-admin-operation-failed', action: 'list' })
    }
    try {
      const page = await personal.value.runtime.list({
        scope: personal.value.scope,
        ...options.value,
      })
      return success({
        ...projectMemoryPage(page),
        readOnly: this.config.administrationMode !== 'full',
        enabled: personal.value.runtime.isEnabled(),
      })
    } catch (error: unknown) {
      this.ctx.logger.warn('memory-candidate-review: personal-memory list failed: %o', error)
      return rejected({ code: 'memory-admin-operation-failed', action: 'list' })
    }
  }

  /**
   * Add one explicit personal fact after a visible confirmation.
   * @param request - Session provenance, complete fact, and explicit confirmation.
   * @returns The created browser-safe row and content-free audit id, or an explicit failure.
   */
  @Remote('rememberPersonalMemory')
  rememberPersonalMemory(request: PersonalMemoryAdminRememberRequest): Promise<PersonalMemoryAdminRememberResult> {
    return this.withPersonalMemory(`personal:create:${String(request.sessionId)}`, request, async (personal) => {
      const content = request.content.trim()
      if (looksSensitive(content)) return adminRejected({ code: 'memory-admin-sensitive-content' })
      const admitted = await this.admitPersonalAdminAction(request.sessionId, 'remember')
      if (!admitted.ok) return admitted
      const audit = admitted.value
      try {
        const created = await personal.runtime.create({
          scope: personal.scope,
          content,
          source: { kind: 'session', sessionId: request.sessionId },
          confidence: 1,
          validation: 'explicit',
        })
        await this.finishPersonalAdminAction(audit, created.id, created.revision)
        return success({
          item: projectMemory(created, memoryStatusAt(created)),
          auditId: audit.id,
        })
      } catch (error: unknown) {
        await this.failPersonalAdminAction(audit, error)
        return adminRejected({ code: 'memory-admin-operation-failed', action: 'remember', auditId: audit.id })
      }
    })
  }

  /**
   * Correct one exact personal-memory revision after confirmation.
   * @param request - Session anchor, exact revision, replacement text, and confirmation.
   * @returns The corrected browser-safe row and content-free audit id, or an explicit failure.
   */
  @Remote('correctPersonalMemory')
  correctPersonalMemory(request: MemoryAdminCorrectRequest): Promise<MemoryAdminCorrectResult> {
    return this.withPersonalMemory(`personal:${String(request.id)}`, request, async (personal) => {
      const content = request.content.trim()
      if (looksSensitive(content)) return adminRejected({ code: 'memory-admin-sensitive-content' })
      const admitted = await this.admitPersonalAdminAction(request.sessionId, 'correct', {
        memoryId: request.id,
        expectedRevision: request.revision,
      })
      if (!admitted.ok) return admitted
      const audit = admitted.value
      try {
        const updated = await personal.runtime.update({
          scope: personal.scope,
          ref: { id: request.id, revision: request.revision },
          content,
          source: { kind: 'session', sessionId: request.sessionId },
        })
        await this.finishPersonalAdminAction(audit, updated.id, updated.revision)
        return success({ item: projectMemory(updated, memoryStatusAt(updated)), auditId: audit.id })
      } catch (error: unknown) {
        await this.failPersonalAdminAction(audit, error)
        return adminRejected({ code: 'memory-admin-operation-failed', action: 'correct', auditId: audit.id })
      }
    })
  }

  /**
   * Permanently remove one personal-memory lineage after confirmation.
   * @param request - Session anchor, exact personal-memory revision, and confirmation.
   * @returns The forgotten reference and content-free audit id, or an explicit failure.
   */
  @Remote('forgetPersonalMemory')
  forgetPersonalMemory(request: MemoryAdminForgetRequest): Promise<MemoryAdminForgetResult> {
    return this.withPersonalMemory(`personal:${String(request.id)}`, request, async (personal) => {
      const admitted = await this.admitPersonalAdminAction(request.sessionId, 'forget', {
        memoryId: request.id,
        expectedRevision: request.revision,
      })
      if (!admitted.ok) return admitted
      const audit = admitted.value
      try {
        await personal.runtime.forget({
          scope: personal.scope,
          ref: { id: request.id, revision: request.revision },
        })
        await this.finishPersonalAdminAction(audit, request.id)
        return success({ id: request.id, revision: request.revision, auditId: audit.id })
      } catch (error: unknown) {
        await this.failPersonalAdminAction(audit, error)
        return adminRejected({ code: 'memory-admin-operation-failed', action: 'forget', auditId: audit.id })
      }
    })
  }

  /**
   * Persist the user's personal-memory enablement preference after confirmation.
   * @param request - Session anchor, desired state, and explicit confirmation.
   * @returns The applied enablement state and content-free audit id, or an explicit failure.
   */
  @Remote('setPersonalMemoryEnabled')
  setPersonalMemoryEnabled(request: PersonalMemoryAdminToggleRequest): Promise<PersonalMemoryAdminToggleResult> {
    return this.enqueue('personal:enabled', async () => {
      if (!request.confirmed) return rejected({ code: 'memory-admin-confirmation-required' })
      const session = await this.resolveSession(request.sessionId)
      if (!session.ok) return session
      const personal = this.personalCapability()
      if (!personal.ok) return personal
      let audit: PersonalMemoryAdminActionRecord
      try {
        audit = await this.beginPersonalAdminAction(request.sessionId, 'toggle', {
          desiredEnabled: request.enabled,
        })
      } catch (error: unknown) {
        this.ctx.logger.error('memory-candidate-review: personal audit admission failed: %o', error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'toggle' })
      }
      try {
        await personal.value.settings.update({ enabled: request.enabled })
        personal.value.runtime.setEnabled(request.enabled)
        await this.finishPersonalAdminAction(audit)
        return success({ enabled: request.enabled, auditId: audit.id })
      } catch (error: unknown) {
        await this.failPersonalAdminAction(audit, error)
        return rejected({ code: 'memory-admin-operation-failed', action: 'toggle', auditId: audit.id })
      }
    })
  }

  /** Enforce deployment rollback and explicit per-action confirmation. */
  private checkAdminMutation(confirmed: boolean): { readonly ok: false; readonly error: MemoryAdminFailure } | undefined {
    if (this.config.administrationMode !== 'full') return rejected({ code: 'memory-admin-read-only' })
    if (!confirmed) return rejected({ code: 'memory-admin-confirmation-required' })
    return undefined
  }

  /** Write the content-free intent record before mutating durable memory. */
  private async beginAdminAction(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    memoryId: MemoryRecord['id'],
    expectedRevision: number,
    action: MemoryAdminActionRecord['action'],
  ): Promise<MemoryAdminActionRecord> {
    const record = Object.freeze({
      id: MemoryAdminActionId(randomUUID()),
      workspaceId,
      sessionId,
      memoryId,
      expectedRevision,
      action,
      status: 'requested',
      createdAt: new Date().toISOString(),
    }) satisfies MemoryAdminActionRecord
    await this.requireAdminTable().put(record.id, record)
    return record
  }

  /** Finalize one mutation trace after the provider confirms durability. */
  private async finishAdminAction(
    record: MemoryAdminActionRecord,
    status: Extract<MemoryAdminActionRecord['status'], 'succeeded'>,
    resultRevision?: number,
  ): Promise<void> {
    try {
      await this.requireAdminTable().put(record.id, {
        ...record,
        status,
        ...(resultRevision === undefined ? {} : { resultRevision }),
        completedAt: new Date().toISOString(),
      })
    } catch (error: unknown) {
      // The provider already confirmed durability. Preserve that successful
      // outcome for the caller instead of inviting an unsafe duplicate retry.
      this.ctx.logger.error('memory-candidate-review: administrative audit completion failed: %o', error)
    }
  }

  /** Best-effort failure finalization without persisting provider messages or memory content. */
  private async failAdminAction(record: MemoryAdminActionRecord, error: unknown): Promise<void> {
    try {
      await this.requireAdminTable().put(record.id, {
        ...record,
        status: 'failed',
        failureCode: safeErrorCode(error),
        completedAt: new Date().toISOString(),
      })
    } catch (auditError: unknown) {
      this.ctx.logger.error('memory-candidate-review: administrative audit finalization failed: %o', auditError)
    }
  }

  /** Write one content-free personal-memory intent before changing durable state. */
  private async beginPersonalAdminAction(
    sessionId: SessionId,
    action: PersonalMemoryAdminActionRecord['action'],
    details: Pick<
      PersonalMemoryAdminActionRecord,
      'memoryId' | 'expectedRevision' | 'desiredEnabled'
    > = {},
  ): Promise<PersonalMemoryAdminActionRecord> {
    const ownerId = this.personalOwnerId
    if (ownerId === undefined) throw new Error('personal-memory owner is unavailable')
    const record = Object.freeze({
      id: MemoryAdminActionId(randomUUID()),
      ownerId,
      sessionId,
      ...details,
      action,
      status: 'requested',
      createdAt: new Date().toISOString(),
    }) satisfies PersonalMemoryAdminActionRecord
    await this.requirePersonalAdminTable().put(record.id, record)
    return record
  }

  /** Admit a content-free personal action and return a stable business failure on audit errors. */
  private async admitPersonalAdminAction(
    sessionId: SessionId,
    action: PersonalMemoryAdminActionRecord['action'],
    details: Pick<
      PersonalMemoryAdminActionRecord,
      'memoryId' | 'expectedRevision' | 'desiredEnabled'
    > = {},
  ): Promise<{ readonly ok: true; readonly value: PersonalMemoryAdminActionRecord } | MemoryAdminRejected> {
    try {
      return success(await this.beginPersonalAdminAction(sessionId, action, details))
    } catch (error: unknown) {
      this.ctx.logger.error('memory-candidate-review: personal audit admission failed: %o', error)
      return rejected({ code: 'memory-admin-operation-failed', action })
    }
  }

  /** Finalize a successful personal-memory action without storing its content. */
  private async finishPersonalAdminAction(
    record: PersonalMemoryAdminActionRecord,
    memoryId?: MemoryRecord['id'],
    resultRevision?: number,
  ): Promise<void> {
    try {
      await this.requirePersonalAdminTable().put(record.id, {
        ...record,
        ...(memoryId === undefined ? {} : { memoryId }),
        ...(resultRevision === undefined ? {} : { resultRevision }),
        status: 'succeeded',
        completedAt: new Date().toISOString(),
      })
    } catch (error: unknown) {
      this.ctx.logger.error('memory-candidate-review: personal audit completion failed: %o', error)
    }
  }

  /** Finalize a failed personal-memory action with a stable machine code only. */
  private async failPersonalAdminAction(
    record: PersonalMemoryAdminActionRecord,
    error: unknown,
  ): Promise<void> {
    try {
      await this.requirePersonalAdminTable().put(record.id, {
        ...record,
        status: 'failed',
        failureCode: safeErrorCode(error),
        completedAt: new Date().toISOString(),
      })
    } catch (auditError: unknown) {
      this.ctx.logger.error('memory-candidate-review: personal audit finalization failed: %o', auditError)
    }
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

  /** Resolve a live or persisted Session without deriving a workspace or personal owner from it. */
  private async resolveSession(sessionId: SessionId): Promise<
    | { readonly ok: true; readonly value: SessionHeader }
    | {
      readonly ok: false
      readonly error: Extract<MemoryCandidateReviewFailure, {
        readonly code: 'memory-review-session-not-found'
      }>
    }
  > {
    const live = this.ctx.sessions.get(sessionId)?.header
    if (live !== undefined) return success(live)
    const snapshot = (await this.ctx.sessionPersistence.listSnapshots())
      .find(entry => entry.header.id === sessionId)
    if (snapshot === undefined) return rejected({ code: 'memory-review-session-not-found', sessionId })
    return success(snapshot.header)
  }

  /** Resolve a live or persisted Session to its registered workspace partition. */
  private async resolveWorkspace(sessionId: SessionId): Promise<
    | { readonly ok: true; readonly value: WorkspaceId }
    | {
      readonly ok: false
      readonly error: Extract<MemoryCandidateReviewFailure, {
        readonly code: 'memory-review-session-not-found' | 'memory-review-workspace-unavailable'
      }>
    }
  > {
    const session = await this.resolveSession(sessionId)
    if (!session.ok) return session
    const header = session.value
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

  /** Return the composed personal-memory runtime, fixed scope, and durable settings handle. */
  private personalCapability():
    | { readonly ok: true; readonly value: PersonalCapabilityValue }
    | { readonly ok: false; readonly error: { readonly code: 'memory-admin-personal-unavailable' } } {
    const runtime = this.personalRuntime
    const settings = this.personalSettings
    const ownerId = this.personalOwnerId
    if (runtime === undefined || settings === undefined || ownerId === undefined) {
      return rejected({ code: 'memory-admin-personal-unavailable' })
    }
    return success({ runtime, settings, scope: { ownerId } })
  }

  /** Authorize and serialize one personal-memory mutation before its operation-specific work. */
  private withPersonalMemory<T>(
    key: string,
    request: PersonalMutationRequest,
    operation: (personal: PersonalCapabilityValue) => Promise<T>,
  ): Promise<T | MemoryAdminRejected> {
    return this.enqueue(key, async () => {
      const admission = this.checkAdminMutation(request.confirmed)
      if (admission !== undefined) return admission
      const session = await this.resolveSession(request.sessionId)
      if (!session.ok) return session
      const personal = this.personalCapability()
      if (!personal.ok) return personal
      return operation(personal.value)
    })
  }

  /** Serialize review writes per candidate so two local tabs cannot replace each other. */
  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
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

  /** Require the initialized content-free administration audit table. */
  private requireAdminTable(): KvTable<MemoryAdminActionId, MemoryAdminActionRecord> {
    if (this.adminTable === undefined) throw new Error('memory-candidate-review: admin domain is not initialized')
    return this.adminTable
  }

  /** Require the initialized content-free personal-memory audit table. */
  private requirePersonalAdminTable(): KvTable<MemoryAdminActionId, PersonalMemoryAdminActionRecord> {
    if (this.personalAdminTable === undefined) {
      throw new Error('memory-candidate-review: personal admin domain is not initialized')
    }
    return this.personalAdminTable
  }
}

/** Return a frozen success branch. */
function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return Object.freeze({ ok: true, value: Object.freeze(value) })
}

/** Return a frozen business-failure branch. */
function rejected<E>(error: E): { readonly ok: false; readonly error: E } {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Preserve the administrative failure discriminants across generic mutation helpers. */
function adminRejected(error: MemoryAdminFailure): MemoryAdminRejected {
  return rejected(error)
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

/** Copy one provider row into a browser-safe administrative projection. */
function projectMemory(record: MemoryRecord | PersonalMemoryRecord, status: MemoryStatus): MemoryAdminItem {
  const redacted = looksSensitive(record.content)
  return Object.freeze({
    id: record.id,
    revision: record.revision,
    ...(redacted ? {} : { content: record.content }),
    redacted,
    status,
    sourceSessionId: record.source.sessionId,
    ...(record.importance === undefined ? {} : { importance: record.importance }),
    ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    ...(record.validation === undefined ? {} : { validation: record.validation }),
    ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
    ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

/** Normalize and bound the shared workspace/personal administrative list controls. */
function normalizedMemoryListOptions(request: MemoryAdminListRequest):
  | { readonly ok: true; readonly value: Omit<MemoryListRequest, 'scope'> }
  | { readonly ok: false } {
  const query = request.query?.trim()
  if (query !== undefined && query.length === 0) return { ok: false }
  return {
    ok: true,
    value: {
      ...(query === undefined ? {} : { query }),
      statuses: request.statuses ?? ['active'],
      offset: clampInteger(request.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      limit: clampInteger(request.limit, 1, MAX_LIMIT, DEFAULT_LIMIT),
    },
  }
}

/** Project a provider page without leaking workspace or personal owner scopes. */
function projectMemoryPage(page: ProjectableMemoryPage): Pick<
  MemoryAdminListValue,
  'items' | 'hasMore' | 'nextOffset'
> {
  return {
    items: Object.freeze(page.items.map(item => projectMemory(item.record, item.status))),
    hasMore: page.hasMore,
    nextOffset: page.nextOffset,
  }
}

/** Return only a stable machine code for the durable content-free audit trail. */
function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 128)
  }
  return 'UNKNOWN'
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

/** Validate and brand the optional deployment-owned personal-memory partition. */
function normalizedPersonalOwnerId(value: string | undefined): PersonalMemoryOwnerIdentity | undefined {
  if (value === undefined) return undefined
  const ownerId = value.trim()
  if (!/^[\w.-]{1,128}$/u.test(ownerId)) {
    throw new TypeError('memory-candidate-review: personalOwnerId must contain 1-128 safe label characters')
  }
  return PersonalMemoryOwnerId(ownerId)
}

/** Clamp one optional integer input to a safe closed interval. */
function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export default MemoryCandidateReviewService
