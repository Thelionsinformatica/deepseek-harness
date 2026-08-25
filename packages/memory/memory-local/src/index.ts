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
import {
  OllamaSemanticIndex,
  SemanticSearchError,
  type OllamaSemanticIndexConfig,
  type SemanticCandidate,
  type SemanticFallbackCode,
} from './semantic.ts'

export { localMemoryDomainSpec, localMemoryRecord } from './spec.ts'
export type { LocalMemoryRecord } from './spec.ts'

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
  /** Optional semantic layer over the durable lexical provider. */
  readonly semanticSearch?: SemanticSearchConfig
}

export const Config: z<Config> = z.object({
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
        ...(request.importance === undefined ? {} : { importance: request.importance }),
        ...(request.confidence === undefined ? {} : { confidence: request.confidence }),
        ...(request.validation === undefined ? {} : { validation: request.validation }),
        schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      }
      await this.table.put(id, stored)
      return project(id, stored)
    })
  }

  async search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]> {
    assertNotAborted(signal)
    const lexical = lexicalSearch(this.table, request)
    if (this.semantic === undefined) return lexical
    const candidates = workspaceCandidates(this.table, request, this.semantic.config.maxCandidates)
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
          return {
            ...current,
            content: request.content,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          }
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
  }, semantic)
  ctx.effect(() => ctx.memory.registerProvider(provider), 'memory-local.registerProvider')
}

function lexicalSearch(
  table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
  request: MemorySearchRequest,
): MemorySearchHit[] {
  const query = normalize(request.query)
  const terms = uniqueTokens(query)
  const hits: MemorySearchHit[] = []
  for (const [id, stored] of table.entries()) {
    if (stored.workspaceId !== request.scope.workspaceId) continue
    const candidate = normalize(stored.content)
    const matched = terms.filter(term => candidate.includes(term)).length
    if (matched === 0 && !candidate.includes(query)) continue
    const exactPhrase = candidate.includes(query) ? 2 : 0
    const coverage = terms.length === 0 ? 0 : matched / terms.length
    hits.push({ record: project(id, stored), score: exactPhrase + coverage })
  }
  return sortHits(hits).slice(0, request.limit)
}

function workspaceCandidates(
  table: KvTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>,
  request: MemorySearchRequest,
  maxCandidates: number,
): SemanticCandidate[] {
  return [...table.entries()]
    .filter(([, stored]) => stored.workspaceId === request.scope.workspaceId)
    .map(([id, stored]) => ({ record: project(id, stored) }))
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
    || String(left.record.id).localeCompare(String(right.record.id)))
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

function project(id: ReturnType<typeof MemoryId>, stored: LocalMemoryRecord): MemoryRecord {
  return {
    id,
    scope: { workspaceId: stored.workspaceId },
    content: stored.content,
    revision: stored.revision,
    schemaVersion: stored.schemaVersion,
    source: stored.source,
    ...(stored.importance === undefined ? {} : { importance: stored.importance }),
    ...(stored.confidence === undefined ? {} : { confidence: stored.confidence }),
    ...(stored.validation === undefined ? {} : { validation: stored.validation }),
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
