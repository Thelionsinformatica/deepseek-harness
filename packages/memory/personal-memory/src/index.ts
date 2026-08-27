/** Durable personal memory capability (`ctx.personalMemory`). */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  isCredentialLikeMemoryContent,
  MemoryError,
  type MemoryRef,
  type MemoryStatus,
} from '@deepseek-ai/dsh-memory'
import type {
  PersonalMemoryBlockedEvent,
  PersonalMemoryCreateRequest,
  PersonalMemoryForgetRequest,
  PersonalMemoryListPage,
  PersonalMemoryListRequest,
  PersonalMemoryOperationEvent,
  PersonalMemoryProvider,
  PersonalMemoryRecord,
  PersonalMemoryScope,
  PersonalMemorySearchHit,
  PersonalMemorySearchRequest,
  PersonalMemoryUpdateRequest,
} from './types.ts'

export { PersonalMemoryOwnerId } from './types.ts'
export type {
  PersonalMemoryBlockedEvent,
  PersonalMemoryCreateRequest,
  PersonalMemoryForgetRequest,
  PersonalMemoryListItem,
  PersonalMemoryListPage,
  PersonalMemoryListRequest,
  PersonalMemoryOperationEvent,
  PersonalMemoryOwnerId as PersonalMemoryOwnerIdentity,
  PersonalMemoryProvider,
  PersonalMemoryRecord,
  PersonalMemoryScope,
  PersonalMemorySearchHit,
  PersonalMemorySearchRequest,
  PersonalMemoryUpdateRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    personalMemory: PersonalMemoryRuntime
  }

  interface Events {
    /**
     * A personal-memory operation completed or failed without exposing its content.
     * @param event - Content-free operation, provider, owner, and result metadata.
     * @mode emit
     */
    'personal-memory/operation'(event: PersonalMemoryOperationEvent): void
    /**
     * A personal-memory operation was rejected before durable mutation.
     * @param event - Sanitized operation, owner, reason, and error code.
     * @mode emit
     */
    'personal-memory/blocked'(event: PersonalMemoryBlockedEvent): void
  }
}

/** Provider selection and audit configuration. */
export interface Config {
  /** Explicit provider id; omitted auto-selects exactly one usable provider. */
  readonly provider?: string
  /** Emit content-free operation and blocked events. */
  readonly telemetryEnabled?: boolean
  /** Initial operation state before an optional settings Consumer applies a durable preference. */
  readonly enabled?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string(),
  telemetryEnabled: z.boolean(),
  enabled: z.boolean(),
})

const MAX_CONTENT_CHARS = 16_384
const MAX_QUERY_CHARS = 2_048
const MAX_SEARCH_RESULTS = 50
const MAX_LIST_RESULTS = 200
const VALID_STATUSES = new Set<MemoryStatus>(['active', 'scheduled', 'expired', 'superseded'])

/** Personal-memory service with an independent provider registry and lifecycle. */
export class PersonalMemoryRuntime extends Service {
  static Config = Config
  private readonly providers = new Map<string, PersonalMemoryProvider>()
  private readonly configuredProvider: string | undefined
  private readonly telemetryEnabled: boolean
  private enabledState: boolean

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'personalMemory')
    this.configuredProvider = config.provider
    this.telemetryEnabled = config.telemetryEnabled ?? true
    this.enabledState = config.enabled ?? true
  }

  /**
   * Register one personal-memory provider for the caller-controlled fiber lifetime.
   * @param provider - Provider implementation keyed by its stable id.
   * @returns disposer that removes this exact registration.
   */
  registerProvider(provider: PersonalMemoryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new MemoryError(
        `a personal-memory provider with id "${provider.id}" is already registered`,
        'PERSONAL_MEMORY_DUPLICATE_PROVIDER',
      )
    }
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * Read whether model and mutation operations may use personal memory.
   * Administrative listing and forgetting remain available while disabled so the user can inspect or delete data.
   * @returns the current process-local operation state.
   */
  isEnabled(): boolean {
    return this.enabledState
  }

  /**
   * Apply a deployment or durable-settings preference to all personal-memory Consumers.
   * @param enabled - Whether create, search, and correction operations may reach a provider.
   */
  setEnabled(enabled: boolean): void {
    this.enabledState = enabled
  }

  /**
   * Create one normalized personal fact in an explicit local-owner partition.
   * @param request - Owner scope, durable content, and session provenance.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns the durable normalized record.
   */
  async create(
    request: PersonalMemoryCreateRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryRecord> {
    const normalized = this.validate('create', request.scope, () => {
      const scope = checkedScope(request.scope)
      return {
        ...request,
        scope,
        content: checkedContent(request.content),
        ...checkedRanking(request),
        ...checkedCreateTimes(request),
      } satisfies PersonalMemoryCreateRequest
    })
    const { scope } = normalized
    return this.execute('create', scope, provider => provider.create(normalized, signal))
  }

  /**
   * Search one local-owner partition for relevant personal facts.
   * @param request - Owner scope, bounded query, and result limit.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns provider-ranked hits capped to the requested limit.
   */
  async search(
    request: PersonalMemorySearchRequest,
    signal?: AbortSignal,
  ): Promise<readonly PersonalMemorySearchHit[]> {
    const normalized = this.validate('search', request.scope, () => ({
      ...request,
      scope: checkedScope(request.scope),
      query: checkedQuery(request.query),
      limit: checkedLimit(request.limit, MAX_SEARCH_RESULTS),
    } satisfies PersonalMemorySearchRequest))
    const { scope, limit } = normalized
    const hits = await this.execute('search', scope, provider => provider.search({
      ...normalized,
    }, signal))
    return hits.slice(0, limit)
  }

  /**
   * Enumerate one bounded personal-memory partition for administration.
   * @param request - Owner scope, optional filters, and page coordinates.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns a stable page of personal-memory revisions.
   */
  async list(
    request: PersonalMemoryListRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryListPage> {
    const normalized = this.validate('list', request.scope, () => {
      const query = request.query === undefined ? undefined : checkedQuery(request.query)
      const statuses = request.statuses === undefined ? undefined : [...new Set(request.statuses)]
      if (statuses?.some(status => !VALID_STATUSES.has(status)) === true) {
        throw validationError('personal-memory list contains an unsupported status', 'PERSONAL_MEMORY_INVALID_STATUS')
      }
      return {
        ...request,
        scope: checkedScope(request.scope),
        ...(query === undefined ? {} : { query }),
        ...(statuses === undefined ? {} : { statuses }),
        offset: checkedOffset(request.offset ?? 0),
        limit: checkedLimit(request.limit, MAX_LIST_RESULTS),
      } satisfies PersonalMemoryListRequest
    })
    return this.execute('list', normalized.scope, provider => provider.list(normalized, signal))
  }

  /**
   * Correct one exact personal-memory revision.
   * @param request - Owner scope, compare-and-set reference, and replacement content.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns the corrected record with an incremented revision.
   */
  async update(
    request: PersonalMemoryUpdateRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryRecord> {
    const normalized = this.validate('update', request.scope, () => {
      checkedRef(request.ref)
      return {
        ...request,
        scope: checkedScope(request.scope),
        content: checkedContent(request.content),
        ...checkedUpdateTimes(request),
      } satisfies PersonalMemoryUpdateRequest
    })
    const { scope } = normalized
    return this.execute('update', scope, provider => provider.update(normalized, signal))
  }

  /**
   * Forget one exact personal-memory revision.
   * @param request - Owner scope and compare-and-set reference to delete.
   * @param signal - Optional cancellation forwarded to the selected provider.
   * @returns resolution after durable deletion.
   */
  async forget(request: PersonalMemoryForgetRequest, signal?: AbortSignal): Promise<void> {
    const normalized = this.validate('forget', request.scope, () => {
      checkedRef(request.ref)
      return { ...request, scope: checkedScope(request.scope) }
    })
    await this.execute('forget', normalized.scope, provider => provider.forget(normalized, signal))
  }

  private validate<T>(
    operation: PersonalMemoryOperationEvent['operation'],
    scope: PersonalMemoryScope,
    validation: () => T,
  ): T {
    try {
      return validation()
    } catch (error: unknown) {
      const errorCode = codeOf(error)
      this.emitBlocked({
        operation,
        ownerId: scope.ownerId,
        reason: errorCode === 'PERSONAL_MEMORY_SENSITIVE_CONTENT' ? 'credential-like' : 'validation',
        errorCode,
      })
      throw error
    }
  }

  private async execute<T>(
    operation: PersonalMemoryOperationEvent['operation'],
    scope: PersonalMemoryScope,
    call: (provider: PersonalMemoryProvider) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now()
    let provider: PersonalMemoryProvider
    try {
      if (!this.enabledState && operation !== 'list' && operation !== 'forget') {
        throw new MemoryError('personal memory is disabled by the user', 'PERSONAL_MEMORY_DISABLED')
      }
      provider = this.resolveProvider()
      const result = await call(provider)
      this.emitOperation({
        operation,
        provider: provider.id,
        success: true,
        ownerId: scope.ownerId,
        ...resultMetadata(operation, result),
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error: unknown) {
      const errorCode = codeOf(error)
      const reason = errorCode === 'PERSONAL_MEMORY_SENSITIVE_CONTENT'
        ? 'credential-like'
        : errorCode === 'PERSONAL_MEMORY_DISABLED' ? 'disabled'
          : errorCode.includes('PROVIDER') ? 'provider' : 'validation'
      this.emitBlocked({ operation, ownerId: scope.ownerId, reason, errorCode })
      throw error
    }
  }

  private resolveProvider(): PersonalMemoryProvider {
    if (this.configuredProvider !== undefined) {
      const selected = this.providers.get(this.configuredProvider)
      if (selected === undefined) {
        throw new MemoryError(
          `configured personal-memory provider "${this.configuredProvider}" is not registered`,
          'PERSONAL_MEMORY_PROVIDER_MISSING',
        )
      }
      if (!selected.available()) {
        throw new MemoryError(
          `configured personal-memory provider "${this.configuredProvider}" is unavailable`,
          'PERSONAL_MEMORY_PROVIDER_UNAVAILABLE',
        )
      }
      return selected
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    if (usable.length === 0) {
      throw new MemoryError('no usable personal-memory provider is registered', 'PERSONAL_MEMORY_PROVIDER_UNAVAILABLE')
    }
    if (usable.length !== 1) {
      throw new MemoryError(
        `multiple personal-memory providers are usable (${usable.map(provider => provider.id).join(', ')})`,
        'PERSONAL_MEMORY_PROVIDER_AMBIGUOUS',
      )
    }
    const [selected] = usable
    if (selected === undefined) {
      throw new MemoryError('no usable personal-memory provider is registered', 'PERSONAL_MEMORY_PROVIDER_UNAVAILABLE')
    }
    return selected
  }

  private emitOperation(event: Omit<PersonalMemoryOperationEvent, 'schemaVersion'>): void {
    if (this.telemetryEnabled) this.ctx.emit('personal-memory/operation', { ...event, schemaVersion: 1 })
  }

  private emitBlocked(event: Omit<PersonalMemoryBlockedEvent, 'schemaVersion'>): void {
    if (this.telemetryEnabled) this.ctx.emit('personal-memory/blocked', { ...event, schemaVersion: 1 })
  }
}

function checkedScope(scope: PersonalMemoryScope): PersonalMemoryScope {
  const ownerId = String(scope.ownerId)
  if (!/^[\w.-]{1,128}$/u.test(ownerId)) {
    throw validationError(
      'personal-memory ownerId must contain 1-128 letters, numbers, dots, underscores, or hyphens',
      'PERSONAL_MEMORY_INVALID_OWNER',
    )
  }
  return scope
}

function checkedContent(value: string): string {
  const content = value.trim()
  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
    throw validationError(
      `personal-memory content must contain 1-${MAX_CONTENT_CHARS} characters`,
      'PERSONAL_MEMORY_INVALID_CONTENT',
    )
  }
  if (isCredentialLikeMemoryContent(content)) {
    throw validationError(
      'personal-memory content appears to contain a credential and was not stored',
      'PERSONAL_MEMORY_SENSITIVE_CONTENT',
    )
  }
  return content
}

function checkedQuery(value: string): string {
  const query = value.trim()
  if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
    throw validationError(
      `personal-memory query must contain 1-${MAX_QUERY_CHARS} characters`,
      'PERSONAL_MEMORY_INVALID_QUERY',
    )
  }
  return query
}

function checkedLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw validationError(
      `personal-memory limit must be an integer from 1-${maximum}`,
      'PERSONAL_MEMORY_INVALID_LIMIT',
    )
  }
  return value
}

function checkedOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw validationError('personal-memory offset must be a non-negative integer', 'PERSONAL_MEMORY_INVALID_OFFSET')
  }
  return value
}

function checkedRef(ref: MemoryRef): void {
  if (String(ref.id).trim().length === 0) {
    throw validationError('personal-memory id must be non-empty', 'PERSONAL_MEMORY_INVALID_ID')
  }
  if (!Number.isSafeInteger(ref.revision) || ref.revision < 1) {
    throw validationError('personal-memory revision must be a positive integer', 'PERSONAL_MEMORY_INVALID_REVISION')
  }
}

function checkedRanking(request: PersonalMemoryCreateRequest): Pick<
  PersonalMemoryCreateRequest,
  'importance' | 'confidence' | 'validation'
> {
  const importance = checkedUnit('importance', request.importance)
  const confidence = checkedUnit('confidence', request.confidence)
  return {
    ...(importance === undefined ? {} : { importance }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(request.validation === undefined ? {} : { validation: request.validation }),
  }
}

function checkedUnit(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw validationError(`personal-memory ${name} must be from 0-1`, `PERSONAL_MEMORY_INVALID_${name.toUpperCase()}`)
  }
  return value
}

function checkedCreateTimes(request: PersonalMemoryCreateRequest): Pick<
  PersonalMemoryCreateRequest,
  'validFrom' | 'expiresAt'
> {
  const validFrom = checkedTimestamp(request.validFrom)
  const expiresAt = checkedTimestamp(request.expiresAt)
  checkedOrder(validFrom, expiresAt)
  return {
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

function checkedUpdateTimes(request: PersonalMemoryUpdateRequest): Pick<
  PersonalMemoryUpdateRequest,
  'validFrom' | 'expiresAt'
> {
  const validFrom = checkedTimestamp(request.validFrom)
  const expiresAt = request.expiresAt === null ? null : checkedTimestamp(request.expiresAt)
  if (expiresAt !== null) checkedOrder(validFrom, expiresAt)
  return {
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

function checkedTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch)) {
    throw validationError('personal-memory timestamp must be valid ISO time', 'PERSONAL_MEMORY_INVALID_TEMPORAL')
  }
  return new Date(epoch).toISOString()
}

function checkedOrder(validFrom: string | undefined, expiresAt: string | undefined): void {
  if (validFrom === undefined || expiresAt === undefined || expiresAt > validFrom) return
  throw validationError('personal-memory expiresAt must follow validFrom', 'PERSONAL_MEMORY_INVALID_TEMPORAL')
}

function resultMetadata(
  operation: PersonalMemoryOperationEvent['operation'],
  result: unknown,
): Pick<PersonalMemoryOperationEvent, 'resultCount' | 'memoryId' | 'revision'> {
  if (operation === 'search' && Array.isArray(result)) return { resultCount: result.length }
  if (operation === 'list' && isListPage(result)) return { resultCount: result.items.length }
  if ((operation === 'create' || operation === 'update') && isRecord(result)) {
    return { memoryId: result.id, revision: result.revision }
  }
  return {}
}

function isRecord(value: unknown): value is PersonalMemoryRecord {
  return typeof value === 'object' && value !== null && 'id' in value && 'revision' in value
}

function isListPage(value: unknown): value is PersonalMemoryListPage {
  return typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)
}

function validationError(message: string, code: string): MemoryError {
  return new MemoryError(message, code)
}

function codeOf(error: unknown): string {
  if (!(error instanceof Error)) return 'PERSONAL_MEMORY_UNKNOWN'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : error.name
}

export default PersonalMemoryRuntime
