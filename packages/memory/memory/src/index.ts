/**
 * Provider-neutral durable memory capability (`ctx.memory`).
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryError } from './types.ts'
import type {
  MemoryBlockedEvent,
  MemoryCreateRequest,
  MemoryCandidateEvent,
  MemoryForgetRequest,
  MemoryProvider,
  MemoryRecord,
  MemorySearchHit,
  MemorySearchRequest,
  MemoryScope,
  MemoryId,
  MemoryOperationEvent,
  MemoryUpdateRequest,
} from './types.ts'
import { MEMORY_EVENT_SCHEMA_VERSION } from './types.ts'

export {
  MemoryError,
  MemoryId,
  MEMORY_EVENT_SCHEMA_VERSION,
  MEMORY_RECORD_SCHEMA_VERSION,
  MEMORY_POLICY_VERSION,
} from './types.ts'
export type {
  MemoryCreateRequest,
  MemoryPolicyDecision,
  MemoryPolicyReason,
  MemoryPolicyVersion,
  MemoryForgetRequest,
  MemoryCandidateEvent,
  MemoryId as MemoryIdType,
  MemoryEventSchemaVersion,
  MemoryOperationEvent,
  MemoryBlockedEvent,
  MemoryRecordSchemaVersion,
  MemoryProvider,
  MemoryRecord,
  MemoryValidation,
  MemoryRef,
  MemoryScope,
  MemorySearchHit,
  MemorySearchRequest,
  MemorySource,
  MemoryUpdateRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRuntime
  }

  interface Events {
    /**
     * Candidate retrieval was screened and assigned a deterministic policy outcome.
     * Observers may persist or aggregate this non-model-facing audit telemetry.
     * @param event - Candidate counts, operation source, and policy decision metadata.
     * @mode emit
     */
    'memory/candidate'(event: MemoryCandidateEvent): void
    /**
     * A durable memory operation completed or failed after provider selection.
     * Observers may record operational health without changing the operation result.
     * @param event - Operation outcome, workspace boundary, provider, and optional result metadata.
     * @mode emit
     */
    'memory/operation'(event: MemoryOperationEvent): void
    /**
     * A memory action was rejected before durable state could be mutated.
     * Observers may surface the sanitized reason in security and integrity dashboards.
     * @param event - Block reason, source, workspace boundary, and optional safe detail.
     * @mode emit
     */
    'memory/blocked'(event: MemoryBlockedEvent): void
  }
}

/** Provider selection config for the memory capability. */
export interface MemoryRuntimeConfig {
  /** Explicit provider id. Omitted auto-selects when exactly one provider is usable. */
  readonly provider?: string
  /** Emit memory observability events and enable audit hooks. */
  readonly telemetryEnabled?: boolean
}

const MAX_CONTENT_CHARS = 16_384
const MAX_QUERY_CHARS = 2_048
const MAX_RESULTS = 50

/** Durable memory service and registration-order-independent provider selector. */
export class MemoryRuntime extends Service {
  static Config: z<MemoryRuntimeConfig> = z.object({
    provider: z.string(),
    telemetryEnabled: z.boolean(),
  })

  private readonly providers = new Map<string, MemoryProvider>()
  private readonly providerId: string | undefined
  private readonly telemetryEnabled: boolean

  constructor(ctx: Context, config: MemoryRuntimeConfig = {}) {
    super(ctx, 'memory')
    this.providerId = config.provider
    this.telemetryEnabled = config.telemetryEnabled ?? true
  }

  /**
   * Register one provider for the lifetime chosen by the caller.
   * @param provider - Provider implementation keyed by its stable id.
   * @returns disposer that removes this exact registration.
   */
  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new MemoryError(
        `a memory provider with id "${provider.id}" is already registered`,
        'MEMORY_DUPLICATE_PROVIDER',
      )
    }
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * Create one normalized durable memory through the selected provider.
   * @param request - Workspace scope, durable content, and session provenance.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns the created normalized record after durability.
   */
  async create(request: MemoryCreateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    const normalized = {
      ...request,
      content: normalizeContent(request.content),
      ...normalizeRankingMetadata(request),
    }
    const startedAt = Date.now()
    try {
      const provider = this.resolveProvider()
      const record = await provider.create(normalized, signal)
      this.emitOperation({
        operation: 'create',
        provider: provider.id,
        success: true,
        workspaceId: request.scope.workspaceId,
        memoryId: record.id,
        revision: record.revision,
        durationMs: Date.now() - startedAt,
      })
      return record
    } catch (error: unknown) {
      const code = extractErrorCode(error)
      this.emitBlocked({
        reason: mapErrorReason(error, 'validation'),
        source: 'memory-runtime',
        workspaceId: request.scope.workspaceId,
        ...(code === undefined ? {} : { detail: code }),
      })
      throw error
    }
  }

  /**
   * Search only inside the request's workspace scope.
   * @param request - Workspace scope, query, and bounded result limit.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns ranked hits capped to the requested limit.
   */
  async search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]> {
    const query = request.query.trim()
    if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
      const error = new MemoryError(
        `memory query must contain 1-${MAX_QUERY_CHARS} characters`,
        'MEMORY_INVALID_QUERY',
      )
      this.emitBlocked({
        reason: 'validation',
        source: 'memory-runtime',
        workspaceId: request.scope.workspaceId,
        detail: error.code,
      })
      throw error
    }
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_RESULTS) {
      const error = new MemoryError(
        `memory result limit must be an integer from 1-${MAX_RESULTS}`,
        'MEMORY_INVALID_LIMIT',
      )
      const code = extractErrorCode(error)
      this.emitBlocked({
        reason: 'validation',
        source: 'memory-runtime',
        workspaceId: request.scope.workspaceId,
        ...(code === undefined ? {} : { detail: code }),
      })
      throw error
    }
    const provider = this.resolveProvider({ scope: request.scope, action: 'search' })
    const startedAt = Date.now()
    try {
      const hits = await provider.search({ ...request, query }, signal)
      const clipped = hits.slice(0, request.limit)
      this.emitOperation({
        operation: 'search',
        provider: provider.id,
        success: true,
        workspaceId: request.scope.workspaceId,
        resultCount: clipped.length,
        durationMs: Date.now() - startedAt,
      })
      return clipped
    } catch (error: unknown) {
      const code = extractErrorCode(error)
      this.emitBlocked({
        reason: mapErrorReason(error, 'provider-unavailable'),
        source: 'memory-runtime',
        workspaceId: request.scope.workspaceId,
        ...(code === undefined ? {} : { detail: code }),
      })
      throw error
    }
  }

  /**
   * Correct one exact memory revision through the selected provider.
   * @param request - Workspace scope, compare-and-set reference, and replacement content.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns the corrected record with its incremented revision.
   */
  async update(request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    validateRef(request.ref.revision)
    const normalized = { ...request, content: normalizeContent(request.content) }
    const provider = this.resolveProvider({
      scope: request.scope,
      action: 'write',
      memoryId: request.ref.id,
      revision: request.ref.revision,
    })
    const startedAt = Date.now()
    try {
      const record = await provider.update(normalized, signal)
      this.emitOperation({
        operation: 'update',
        provider: provider.id,
        success: true,
        workspaceId: request.scope.workspaceId,
        memoryId: record.id,
        revision: record.revision,
        durationMs: Date.now() - startedAt,
      })
      return record
    } catch (error: unknown) {
      this.rethrowWriteError(provider, request, error)
    }
  }

  /**
   * Forget one exact memory revision through the selected provider.
   * @param request - Workspace scope and compare-and-set reference to delete.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns resolution after durable deletion.
   */
  async forget(request: MemoryForgetRequest, signal?: AbortSignal): Promise<void> {
    validateRef(request.ref.revision)
    const provider = this.resolveProvider({
      scope: request.scope,
      action: 'write',
      memoryId: request.ref.id,
      revision: request.ref.revision,
    })
    const startedAt = Date.now()
    try {
      await provider.forget(request, signal)
      this.emitOperation({
        operation: 'forget',
        provider: provider.id,
        success: true,
        workspaceId: request.scope.workspaceId,
        memoryId: request.ref.id,
        revision: request.ref.revision,
        durationMs: Date.now() - startedAt,
      })
    } catch (error: unknown) {
      this.rethrowWriteError(provider, request, error)
    }
  }

  private rethrowWriteError(
    provider: MemoryProvider,
    request: Pick<MemoryUpdateRequest, 'scope' | 'ref'>,
    error: unknown,
  ): never {
    const errorCode = extractErrorCode(error)
    if (!(provider.id === 'local' && errorCode === 'MEMORY_NOT_FOUND')) {
      this.emitBlocked({
        reason: mapErrorReason(error, errorCode === 'MEMORY_NOT_FOUND' ? 'cross-scope-write' : 'validation'),
        source: 'memory-runtime',
        workspaceId: request.scope.workspaceId,
        memoryId: request.ref.id,
        ...(errorCode === undefined ? {} : { detail: errorCode }),
      })
    }
    throw error
  }

  private resolveProvider(hint?: {
    scope: MemoryScope
    action: 'search' | 'write'
    memoryId?: MemoryId
    revision?: number
  }): MemoryProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        if (hint !== undefined) {
          this.emitBlocked({
            reason: 'provider-missing',
            source: 'memory-runtime',
            workspaceId: hint.scope.workspaceId,
            ...(hint.memoryId === undefined ? {} : { memoryId: hint.memoryId }),
            detail: `configured memory provider "${this.providerId}" is not registered`,
          })
        }
        throw new MemoryError(
          `configured memory provider "${this.providerId}" is not registered`,
          'MEMORY_PROVIDER_CONFIGURED_MISSING',
        )
      }
      if (!provider.available()) {
        if (hint !== undefined) {
          this.emitBlocked({
            reason: 'provider-unavailable',
            source: 'memory-runtime',
            workspaceId: hint.scope.workspaceId,
            ...(hint.memoryId === undefined ? {} : { memoryId: hint.memoryId }),
            detail: `configured memory provider "${this.providerId}" is registered but unavailable`,
          })
        }
        throw new MemoryError(
          `configured memory provider "${this.providerId}" is registered but unavailable`,
          'MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE',
        )
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      if (hint !== undefined) {
        this.emitBlocked({
          reason: 'provider-unavailable',
          source: 'memory-runtime',
          workspaceId: hint.scope.workspaceId,
          ...(hint.memoryId === undefined ? {} : { memoryId: hint.memoryId }),
          detail: 'no usable memory provider is registered',
        })
      }
      throw new MemoryError('no usable memory provider is registered', 'MEMORY_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      if (hint !== undefined) {
        this.emitBlocked({
          reason: 'provider-missing',
          source: 'memory-runtime',
          workspaceId: hint.scope.workspaceId,
          ...(hint.memoryId === undefined ? {} : { memoryId: hint.memoryId }),
          detail: `multiple usable providers: ${usable.map(provider => provider.id).join(', ')}`,
        })
      }
      throw new MemoryError(
        `multiple usable memory providers are registered (${usable.map(provider => provider.id).join(', ')}); configure one explicitly`,
        'MEMORY_PROVIDER_AMBIGUOUS',
      )
    }
    return single
  }

  private emitOperation(event: Omit<MemoryOperationEvent, 'schemaVersion'>): void {
    if (!this.telemetryEnabled) return
    this.ctx.emit('memory/operation', { ...event, schemaVersion: MEMORY_EVENT_SCHEMA_VERSION })
  }

  private emitBlocked(event: Omit<MemoryBlockedEvent, 'schemaVersion'>): void {
    if (!this.telemetryEnabled) return
    this.ctx.emit('memory/blocked', { ...event, schemaVersion: MEMORY_EVENT_SCHEMA_VERSION })
  }
}

/** Trim and bound durable text at the provider-neutral boundary. */
function normalizeContent(content: string): string {
  const normalized = content.trim()
  if (normalized.length === 0 || normalized.length > MAX_CONTENT_CHARS) {
    throw new MemoryError(
      `memory content must contain 1-${MAX_CONTENT_CHARS} characters`,
      'MEMORY_INVALID_CONTENT',
    )
  }
  return normalized
}

/** Validate optional ranking signals at the provider-neutral write boundary. */
function normalizeRankingMetadata(request: MemoryCreateRequest): Pick<
  MemoryCreateRequest,
  'importance' | 'confidence' | 'validation'
> {
  const importance = optionalUnitInterval('importance', request.importance)
  const confidence = optionalUnitInterval('confidence', request.confidence)
  const validation: unknown = request.validation
  if (validation !== undefined && validation !== 'explicit' && validation !== 'reviewed') {
    throw new MemoryError(
      'memory validation must be "explicit" or "reviewed"',
      'MEMORY_INVALID_VALIDATION',
    )
  }
  return {
    ...(importance === undefined ? {} : { importance }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(validation === undefined ? {} : { validation }),
  }
}

function optionalUnitInterval(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryError(`memory ${name} must be a finite number from 0-1`, `MEMORY_INVALID_${name.toUpperCase()}`)
  }
  return value
}

/** Validate compare-and-set revisions before a provider sees them. */
function validateRef(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MemoryError('memory revision must be a positive safe integer', 'MEMORY_INVALID_REVISION')
  }
}

/** Best-effort extraction of the known machine-readable reason from provider errors. */
function extractErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const detail = error as { code?: unknown }
  return typeof detail.code === 'string' ? detail.code : error.name
}

function mapErrorReason(
  error: unknown,
  fallback: MemoryBlockedEvent['reason'],
): MemoryBlockedEvent['reason'] {
  const code = extractErrorCode(error)
  switch (code) {
    case 'MEMORY_PROVIDER_CONFIGURED_MISSING':
    case 'MEMORY_PROVIDER_AMBIGUOUS':
      return 'provider-missing'
    case 'MEMORY_PROVIDER_UNAVAILABLE':
    case 'MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE':
      return 'provider-unavailable'
    case 'MEMORY_NOT_FOUND':
      return 'cross-scope-write'
    default:
      return fallback
  }
}

export default MemoryRuntime
