/**
 * Local durable memory Service Provider over `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-memory-local
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryError,
  MemoryId,
  memoryStatusAt,
  MEMORY_EVENT_SCHEMA_VERSION,
  MEMORY_RECORD_SCHEMA_VERSION,
  type MemoryBlockedEvent,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
  type MemoryListItem,
  type MemoryListPage,
  type MemoryListRequest,
  type MemoryProvider,
  type MemoryRecord,
  type MemorySearchHit,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import { localMemoryDomainSpec } from './spec.ts'
import type { LocalMemoryRecord, LocalMemoryVersion } from './spec.ts'
import {
  OllamaSemanticIndex,
  SemanticSearchError,
  type OllamaSemanticIndexConfig,
  type SemanticCandidate,
  type SemanticFallbackCode,
} from './semantic.ts'

export { localMemoryDomainSpec, localMemoryRecord, localMemoryVersion } from './spec.ts'
export type { LocalMemoryRecord, LocalMemoryVersion } from './spec.ts'

export const name = 'memory-local'
export const inject = ['memory', 'storageDomain']

/** Optional local semantic retrieval policy; lexical ranking always remains available. */
export interface SemanticSearchConfig {
  /** Enable local Ollama embeddings. Disabled by default. */
  readonly enabled?: boolean
  /** Loopback Ollama origin; non-loopback endpoints are rejected. */
  readonly baseUrl?: string
  /** Installed Ollama embedding model. */
  readonly model?: string
  /** Matryoshka output dimensions from 64 through 768. */
  readonly dimensions?: number
  /** Total embedding request deadline in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum workspace records considered by one semantic query. */
  readonly maxCandidates?: number
  /** Maximum document vectors retained in the process-local LRU index. */
  readonly maxCacheEntries?: number
  /** Maximum accepted Ollama response body size in bytes. */
  readonly maxResponseBytes?: number
  /** Minimum cosine score for a semantic-only result. */
  readonly minimumScore?: number
  /** Semantic contribution to the final hybrid score. */
  readonly semanticWeight?: number
  /** Lexical contribution to the final hybrid score. */
  readonly lexicalWeight?: number
}

/** Local provider configuration. */
export interface Config {
  /** Revision-history policy; `v1` overwrites in place as an emergency rollback. */
  readonly historyMode?: 'v1' | 'temporal-v2'
  /** Optional semantic layer over the durable lexical provider. */
  readonly semanticSearch?: SemanticSearchConfig
}

export const Config: z<Config> = z.object({
  historyMode: z.union(['v1', 'temporal-v2'] as const).default('temporal-v2'),
  semanticSearch: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default('http://127.0.0.1:11434'),
    model: z.string().default('nomic-embed-text:latest'),
    dimensions: z.number().default(256),
    timeoutMs: z.number().default(10_000),
    maxCandidates: z.number().default(200),
    maxCacheEntries: z.number().default(2_000),
    maxResponseBytes: z.number().default(8_000_000),
    minimumScore: z.number().default(0.55),
    semanticWeight: z.number().default(0.8),
    lexicalWeight: z.number().default(0.2),
  }),
})

/** Content-free observability for one optional semantic retrieval attempt. */
export interface LocalSemanticSearchEvent {
  readonly schemaVersion: 1
  readonly workspaceId: MemorySearchRequest['scope']['workspaceId']
  readonly mode: 'hybrid' | 'lexical-fallback'
  readonly model: string
  readonly candidateCount: number
  readonly embeddedCount: number
  readonly cacheHitCount: number
  readonly resultCount: number
  readonly durationMs: number
  readonly fallbackCode?: SemanticFallbackCode
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Optional semantic retrieval completed or fell back without exposing query or memory text.
     * @param event - Retrieval mode, bounded cost counters, and sanitized failure class.
     * @mode emit
     */
    'memory/semantic-search'(event: LocalSemanticSearchEvent): void
  }
}

interface ResolvedSemanticSearchConfig extends OllamaSemanticIndexConfig {
  readonly enabled: boolean
  readonly maxCandidates: number
  readonly minimumScore: number
  readonly semanticWeight: number
  readonly lexicalWeight: number
}

interface SemanticRuntime {
  readonly index: OllamaSemanticIndex
  readonly config: ResolvedSemanticSearchConfig
  readonly emit: (event: Omit<LocalSemanticSearchEvent, 'schemaVersion'>) => void
}

/** Durable lexical provider with optional loopback semantic reranking. */
export class LocalMemoryProvider implements MemoryProvider {
  readonly id = 'local'
  private operationTail: Promise<void> = Promise.resolve()
  constructor(
    private readonly table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
    private readonly emitBlocked?: (event: Omit<MemoryBlockedEvent, 'schemaVersion'>) => void,
    private readonly semantic?: SemanticRuntime,
    private readonly historyMode: NonNullable<Config['historyMode']> = 'temporal-v2',
  ) {}

  available(): boolean {
    return true
  }

  create(request: MemoryCreateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      assertNotAborted(signal)
      const id = MemoryId(randomUUID())
      const now = new Date().toISOString()
      const validFrom = request.validFrom ?? now
      assertExpiryAfter(request.expiresAt, validFrom)
      const stored: LocalMemoryRecord = {
        workspaceId: request.scope.workspaceId,
        content: request.content,
        revision: 1,
        source: request.source,
        ...(request.importance === undefined ? {} : { importance: request.importance }),
        ...(request.confidence === undefined ? {} : { confidence: request.confidence }),
        ...(request.validation === undefined ? {} : { validation: request.validation }),
        schemaVersion: this.historyMode === 'temporal-v2' ? MEMORY_RECORD_SCHEMA_VERSION : 1,
        ...(this.historyMode === 'temporal-v2' ? { validFrom } : {}),
        ...(this.historyMode === 'temporal-v2' && request.expiresAt !== undefined
          ? { expiresAt: request.expiresAt }
          : {}),
        createdAt: now,
        updatedAt: now,
      }
      await this.table.put(id, stored)
      return project(id, stored)
    })
  }

  async search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]> {
    assertNotAborted(signal)
    const lexical = lexicalSearch(this.table, request, this.historyMode)
    if (this.semantic === undefined || request.includeHistory === true) return lexical
    const candidates = workspaceCandidates(
      this.table,
      request,
      this.semantic.config.maxCandidates,
      this.historyMode,
    )
    const startedAt = Date.now()
    try {
      const ranking = await this.semantic.index.rank(request.query, candidates, signal)
      assertNotAborted(signal)
      const hits = hybridHits(
        lexical,
        candidates,
        ranking.scores,
        this.semantic.config,
        request.limit,
      )
      this.semantic.emit({
        workspaceId: request.scope.workspaceId,
        mode: 'hybrid',
        model: this.semantic.config.model,
        candidateCount: candidates.length,
        embeddedCount: ranking.embeddedCount,
        cacheHitCount: ranking.cacheHitCount,
        resultCount: hits.length,
        durationMs: ranking.durationMs,
      })
      return hits
    } catch (error: unknown) {
      assertNotAborted(signal)
      this.semantic.emit({
        workspaceId: request.scope.workspaceId,
        mode: 'lexical-fallback',
        model: this.semantic.config.model,
        candidateCount: candidates.length,
        embeddedCount: 0,
        cacheHitCount: 0,
        resultCount: lexical.length,
        durationMs: Date.now() - startedAt,
        fallbackCode: semanticFallbackCode(error),
      })
      return lexical
    }
  }

  list(request: MemoryListRequest, signal?: AbortSignal): Promise<MemoryListPage> {
    assertNotAborted(signal)
    const query = request.query === undefined ? undefined : normalize(request.query)
    const statusFilter = request.statuses === undefined ? undefined : new Set(request.statuses)
    const now = Date.now()
    const matching: MemoryListItem[] = []
    for (const [id, stored] of this.table.entries()) {
      if (stored.workspaceId !== request.scope.workspaceId) continue
      for (const record of searchableRecords(id, stored, true, this.historyMode, now)) {
        const status = memoryStatusAt(record, now)
        if (statusFilter !== undefined && !statusFilter.has(status)) continue
        if (query !== undefined
          && !normalize(record.content).includes(query)
          && !normalize(String(record.id)).includes(query)) continue
        matching.push({ record, status })
      }
    }
    matching.sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt)
      || String(left.record.id).localeCompare(String(right.record.id))
      || right.record.revision - left.record.revision)
    const offset = request.offset ?? 0
    const items = matching.slice(offset, offset + request.limit)
    return Promise.resolve(Object.freeze({
      items: Object.freeze(items),
      hasMore: offset + items.length < matching.length,
      nextOffset: offset + items.length,
    }))
  }

  update(request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.enqueue(async () => {
      assertNotAborted(signal)
      try {
        const updated = await this.table.update(request.ref.id, (current) => {
          assertVisibleRevision(
            current,
            request.scope.workspaceId,
            request.ref.id,
            request.ref.revision,
            this.emitBlocked,
          )
          if (this.historyMode === 'v1') {
            return {
              ...current,
              content: request.content,
              revision: current.revision + 1,
              updatedAt: new Date().toISOString(),
            }
          }
          return supersede(current, request.ref.id, request)
        })
        this.semantic?.index.invalidate(request.ref.id)
        return project(request.ref.id, updated)
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
      this.semantic?.index.invalidate(request.ref.id)
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
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const domain = await ctx.storageDomain.open(localMemoryDomainSpec)
  ctx.effect(() => () => domain.close(), 'memory-local.domainClose')
  const semanticConfig = resolveSemanticConfig(config.semanticSearch)
  const semantic: SemanticRuntime | undefined = semanticConfig.enabled
    ? {
      config: semanticConfig,
      index: new OllamaSemanticIndex(semanticConfig),
      emit: (event) => {
        ctx.emit('memory/semantic-search', { ...event, schemaVersion: 1 })
      },
    }
    : undefined
  const provider = new LocalMemoryProvider(domain.table('memories'), (event) => {
    ctx.emit('memory/blocked', {
      ...event,
      schemaVersion: MEMORY_EVENT_SCHEMA_VERSION,
      source: 'memory-local',
    })
  }, semantic, config.historyMode ?? 'temporal-v2')
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-local.registerProvider')
}

function lexicalSearch(
  table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
  request: MemorySearchRequest,
  historyMode: NonNullable<Config['historyMode']>,
): MemorySearchHit[] {
  const query = normalize(request.query)
  const terms = uniqueTokens(query)
  const hits: MemorySearchHit[] = []
  const now = Date.now()
  for (const [id, stored] of table.entries()) {
    if (stored.workspaceId !== request.scope.workspaceId) continue
    for (const record of searchableRecords(id, stored, request.includeHistory === true, historyMode, now)) {
      const candidate = normalize(record.content)
      const matched = terms.filter(term => candidate.includes(term)).length
      if (matched === 0 && !candidate.includes(query)) continue
      const exactPhrase = candidate.includes(query) ? 2 : 0
      const coverage = terms.length === 0 ? 0 : matched / terms.length
      hits.push({ record, score: exactPhrase + coverage })
    }
  }
  return sortHits(hits).slice(0, request.limit)
}

function workspaceCandidates(
  table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
  request: MemorySearchRequest,
  maxCandidates: number,
  historyMode: NonNullable<Config['historyMode']>,
): SemanticCandidate[] {
  const now = Date.now()
  return [...table.entries()]
    .filter(([, stored]) => stored.workspaceId === request.scope.workspaceId)
    .flatMap(([id, stored]) => searchableRecords(id, stored, false, historyMode, now)
      .map(record => ({ record })))
    .sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt)
      || String(left.record.id).localeCompare(String(right.record.id)))
    .slice(0, maxCandidates)
}

function hybridHits(
  lexical: readonly MemorySearchHit[],
  candidates: readonly SemanticCandidate[],
  semanticScores: ReadonlyMap<MemorySearchHit['record']['id'], number>,
  config: Pick<ResolvedSemanticSearchConfig, 'minimumScore' | 'semanticWeight' | 'lexicalWeight'>,
  limit: number,
): MemorySearchHit[] {
  const records = new Map(lexical.map(hit => [hit.record.id, hit.record]))
  for (const candidate of candidates) records.set(candidate.record.id, candidate.record)
  const lexicalScores = new Map(lexical.map(hit => [hit.record.id, Math.min(1, hit.score / 3)]))
  const hits: MemorySearchHit[] = []
  for (const [id, record] of records) {
    const lexicalScore = lexicalScores.get(id)
    const semanticScore = semanticScores.get(id)
    if (lexicalScore === undefined
      && (semanticScore === undefined || semanticScore < config.minimumScore)) continue
    const score = (lexicalScore ?? 0) * config.lexicalWeight
      + (semanticScore ?? 0) * config.semanticWeight
    if (score > 0) hits.push({ record, score })
  }
  return sortHits(hits).slice(0, limit)
}

function sortHits(hits: MemorySearchHit[]): MemorySearchHit[] {
  return hits.sort((left, right) => right.score - left.score
    || right.record.updatedAt.localeCompare(left.record.updatedAt)
    || String(left.record.id).localeCompare(String(right.record.id))
    || right.record.revision - left.record.revision)
}

function resolveSemanticConfig(input: SemanticSearchConfig = {}): ResolvedSemanticSearchConfig {
  const resolved: ResolvedSemanticSearchConfig = {
    enabled: input.enabled ?? false,
    baseUrl: validateLoopbackBaseUrl(input.baseUrl ?? 'http://127.0.0.1:11434'),
    model: input.model?.trim() ?? 'nomic-embed-text:latest',
    dimensions: input.dimensions ?? 256,
    timeoutMs: input.timeoutMs ?? 10_000,
    maxCandidates: input.maxCandidates ?? 200,
    maxCacheEntries: input.maxCacheEntries ?? 2_000,
    maxResponseBytes: input.maxResponseBytes ?? 8_000_000,
    minimumScore: input.minimumScore ?? 0.55,
    semanticWeight: input.semanticWeight ?? 0.8,
    lexicalWeight: input.lexicalWeight ?? 0.2,
  }
  if (resolved.model.length === 0 || resolved.model.length > 256) {
    throw new TypeError('memory-local: semantic model must contain 1-256 characters')
  }
  assertIntegerRange('dimensions', resolved.dimensions, 64, 768)
  assertIntegerRange('timeoutMs', resolved.timeoutMs, 1, 2_147_483_647)
  assertIntegerRange('maxCandidates', resolved.maxCandidates, 1, 10_000)
  assertIntegerRange('maxCacheEntries', resolved.maxCacheEntries, 1, 100_000)
  assertIntegerRange('maxResponseBytes', resolved.maxResponseBytes, 1, 100_000_000)
  assertUnitInterval('minimumScore', resolved.minimumScore)
  assertNonNegativeFinite('semanticWeight', resolved.semanticWeight)
  assertNonNegativeFinite('lexicalWeight', resolved.lexicalWeight)
  if (resolved.semanticWeight + resolved.lexicalWeight === 0) {
    throw new TypeError('memory-local: semanticWeight and lexicalWeight cannot both be zero')
  }
  return resolved
}

function validateLoopbackBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('memory-local: semantic baseUrl must be an absolute loopback HTTP origin')
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'http:'
    || !loopback
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search.length > 0
    || url.hash.length > 0) {
    throw new TypeError('memory-local: semantic baseUrl must be an absolute loopback HTTP origin')
  }
  return url.origin
}

function assertIntegerRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`memory-local: semantic ${name} must be an integer from ${min}-${max}`)
  }
}

function assertUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`memory-local: semantic ${name} must be a finite number from 0-1`)
  }
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`memory-local: semantic ${name} must be a non-negative finite number`)
  }
}

function semanticFallbackCode(error: unknown): SemanticSearchError['code'] {
  /* v8 ignore else -- OllamaSemanticIndex normalizes every non-abort failure before it reaches the provider. */
  if (error instanceof SemanticSearchError) return error.code
  /* v8 ignore next -- OllamaSemanticIndex normalizes every non-abort failure before it reaches the provider. */
  return 'TRANSPORT'
}

function supersede(
  current: LocalMemoryRecord,
  id: ReturnType<typeof MemoryId>,
  request: MemoryUpdateRequest,
): LocalMemoryRecord {
  const now = new Date().toISOString()
  const validFrom = request.validFrom ?? now
  const inheritedExpiry = current.expiresAt !== undefined && current.expiresAt > validFrom
    ? current.expiresAt
    : undefined
  const expiresAt = request.expiresAt === null ? undefined : request.expiresAt ?? inheritedExpiry
  assertExpiryAfter(expiresAt, validFrom)
  const previousRef = { id, revision: current.revision }
  const nextRef = { id, revision: current.revision + 1 }
  const prior: LocalMemoryVersion = {
    ...versionOf(current),
    validUntil: validFrom,
    supersededBy: nextRef,
  }
  return {
    workspaceId: current.workspaceId,
    content: request.content,
    revision: nextRef.revision,
    source: request.source ?? current.source,
    ...(current.importance === undefined ? {} : { importance: current.importance }),
    ...(current.confidence === undefined ? {} : { confidence: current.confidence }),
    ...(current.validation === undefined ? {} : { validation: current.validation }),
    schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
    validFrom,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    supersedes: previousRef,
    createdAt: current.createdAt,
    updatedAt: now,
    history: [...(current.history ?? []), prior],
  }
}

function versionOf(record: LocalMemoryRecord): LocalMemoryVersion {
  return {
    content: record.content,
    revision: record.revision,
    source: record.source,
    ...(record.importance === undefined ? {} : { importance: record.importance }),
    ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    ...(record.validation === undefined ? {} : { validation: record.validation }),
    schemaVersion: record.schemaVersion,
    ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
    ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.supersedes === undefined ? {} : { supersedes: record.supersedes }),
    ...(record.supersededBy === undefined ? {} : { supersededBy: record.supersededBy }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function searchableRecords(
  id: ReturnType<typeof MemoryId>,
  stored: LocalMemoryRecord,
  includeHistory: boolean,
  historyMode: NonNullable<Config['historyMode']>,
  now: number,
): MemoryRecord[] {
  const current = project(id, stored)
  if (historyMode === 'v1') {
    if (!validTemporalRecord(current)) return []
    return includeHistory || activeAt(current, now) ? [current] : []
  }
  const lineage = [
    current,
    ...(stored.history ?? []).map(version => projectVersion(id, stored.workspaceId, version)),
  ]
  return includeHistory ? lineage.filter(validTemporalRecord) : lineage.filter(record => activeAt(record, now))
}

function activeAt(record: MemoryRecord, now: number): boolean {
  if (!validTemporalRecord(record)) return false
  if (record.supersededBy !== undefined && record.validUntil === undefined) return false
  if (record.validFrom !== undefined && Date.parse(record.validFrom) > now) return false
  if (record.validUntil !== undefined && Date.parse(record.validUntil) <= now) return false
  return record.expiresAt === undefined || Date.parse(record.expiresAt) > now
}

function validTemporalRecord(record: MemoryRecord): boolean {
  const validFrom = optionalTime(record.validFrom)
  const validUntil = optionalTime(record.validUntil)
  const expiresAt = optionalTime(record.expiresAt)
  if (validFrom === false || validUntil === false || expiresAt === false) return false
  if (typeof validFrom === 'number' && typeof validUntil === 'number' && validUntil < validFrom) return false
  if (typeof validFrom === 'number' && typeof expiresAt === 'number' && expiresAt <= validFrom) return false
  return validRef(record.supersedes) && validRef(record.supersededBy)
}

function optionalTime(value: string | undefined): number | undefined | false {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : false
}

function validRef(ref: MemoryRecord['supersedes']): boolean {
  return ref === undefined || (String(ref.id).length > 0 && Number.isSafeInteger(ref.revision) && ref.revision > 0)
}

function assertExpiryAfter(expiresAt: string | undefined, validFrom: string): void {
  if (expiresAt === undefined) return
  const start = Date.parse(validFrom)
  const expiry = Date.parse(expiresAt)
  if (Number.isFinite(start) && Number.isFinite(expiry) && expiry > start) return
  throw new MemoryError('memory expiresAt must be later than validFrom', 'MEMORY_INVALID_TEMPORAL')
}

function project(id: ReturnType<typeof MemoryId>, stored: LocalMemoryRecord): MemoryRecord {
  return projectVersion(id, stored.workspaceId, stored)
}

function projectVersion(
  id: ReturnType<typeof MemoryId>,
  workspaceId: LocalMemoryRecord['workspaceId'],
  stored: LocalMemoryVersion,
): MemoryRecord {
  return {
    id,
    scope: { workspaceId },
    content: stored.content,
    revision: stored.revision,
    schemaVersion: stored.schemaVersion,
    source: stored.source,
    ...(stored.importance === undefined ? {} : { importance: stored.importance }),
    ...(stored.confidence === undefined ? {} : { confidence: stored.confidence }),
    ...(stored.validation === undefined ? {} : { validation: stored.validation }),
    ...(stored.validFrom === undefined ? {} : { validFrom: stored.validFrom }),
    ...(stored.validUntil === undefined ? {} : { validUntil: stored.validUntil }),
    ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
    ...(stored.supersedes === undefined ? {} : { supersedes: stored.supersedes }),
    ...(stored.supersededBy === undefined ? {} : { supersededBy: stored.supersededBy }),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/** Accent-insensitive, case-insensitive text used only for local lexical ranking. */
function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

const LEXICAL_STOP_WORDS = new Set([
  'a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'era', 'foi', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'para', 'por', 'qual', 'que', 'sobre', 'um', 'uma',
])

function uniqueTokens(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(token => !LEXICAL_STOP_WORDS.has(token))
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
