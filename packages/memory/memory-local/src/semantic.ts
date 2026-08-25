/** Local Ollama embedding transport and bounded in-process semantic index. @module @deepseek-ai/dsh-memory-local/semantic */

import type { MemoryIdType, MemoryRecord } from '@deepseek-ai/dsh-memory'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

const SEMANTIC_TIMEOUT_CODE = 'MEMORY_SEMANTIC_TIMEOUT'

/** Stable reasons why semantic retrieval can fall back to lexical ranking. */
export type SemanticFallbackCode =
  | 'TIMEOUT'
  | 'TRANSPORT'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'

/** Fully validated transport and cache policy for the local semantic index. */
export interface OllamaSemanticIndexConfig {
  readonly baseUrl: string
  readonly model: string
  readonly dimensions: number
  readonly timeoutMs: number
  readonly maxCacheEntries: number
  readonly maxResponseBytes: number
}

/** Ranked candidate input whose public record retains workspace provenance. */
export interface SemanticCandidate {
  readonly record: MemoryRecord
}

/** Semantic scores and cost counters for one bounded query. */
export interface SemanticRanking {
  readonly scores: ReadonlyMap<MemoryIdType, number>
  readonly embeddedCount: number
  readonly cacheHitCount: number
  readonly durationMs: number
}

interface CachedEmbedding {
  readonly revision: number
  readonly vector: readonly number[]
}

/** Sanitized transport failure consumed by the lexical fallback path. */
export class SemanticSearchError extends Error {
  override name = 'SemanticSearchError'

  /**
   * @param code - Stable fallback class safe for telemetry.
   */
  constructor(readonly code: SemanticFallbackCode) {
    super(`local semantic search failed: ${code}`)
  }
}

/** Bounded LRU document index backed by Ollama's local `/api/embed` endpoint. */
export class OllamaSemanticIndex {
  private readonly cache = new Map<MemoryIdType, CachedEmbedding>()
  private readonly endpoint: URL

  /**
   * @param config - Validated local endpoint, model, dimensions, and resource limits.
   */
  constructor(private readonly config: OllamaSemanticIndexConfig) {
    this.endpoint = new URL('/api/embed', config.baseUrl)
  }

  /**
   * Rank one workspace-filtered candidate set against a natural-language query.
   * @param query - Trimmed memory query.
   * @param candidates - Records already filtered to one workspace and bounded by policy.
   * @param signal - Optional caller cancellation.
   * @returns cosine scores and cache/latency counters without retaining query text.
   */
  async rank(
    query: string,
    candidates: readonly SemanticCandidate[],
    signal?: AbortSignal,
  ): Promise<SemanticRanking> {
    const startedAt = Date.now()
    if (candidates.length === 0) {
      return { scores: new Map(), embeddedCount: 0, cacheHitCount: 0, durationMs: 0 }
    }
    const missing: SemanticCandidate[] = []
    const vectors = new Map<MemoryIdType, readonly number[]>()
    for (const candidate of candidates) {
      const cached = this.takeCached(candidate.record.id, candidate.record.revision)
      if (cached === undefined) missing.push(candidate)
      else vectors.set(candidate.record.id, cached)
    }
    const inputs = [
      `search_query: ${query}`,
      ...missing.map(candidate => `search_document: ${candidate.record.content}`),
    ]
    const embedded = await this.embed(inputs, signal)
    const queryVector = requiredVector(embedded[0])
    for (const [index, candidate] of missing.entries()) {
      const vector = requiredVector(embedded[index + 1])
      vectors.set(candidate.record.id, vector)
      this.cacheEmbedding(candidate.record.id, candidate.record.revision, vector)
    }
    const scores = new Map<MemoryIdType, number>()
    for (const candidate of candidates) {
      const vector = requiredVector(vectors.get(candidate.record.id))
      scores.set(candidate.record.id, cosine(queryVector, vector))
    }
    return {
      scores,
      embeddedCount: missing.length,
      cacheHitCount: candidates.length - missing.length,
      durationMs: Date.now() - startedAt,
    }
  }

  /**
   * Remove one corrected or forgotten record from the process-local index.
   * @param id - Durable memory identity whose cached revision is stale.
   */
  invalidate(id: MemoryIdType): void {
    this.cache.delete(id)
  }

  private takeCached(id: MemoryIdType, revision: number): readonly number[] | undefined {
    const cached = this.cache.get(id)
    if (cached === undefined || cached.revision !== revision) {
      this.cache.delete(id)
      return undefined
    }
    this.cache.delete(id)
    this.cache.set(id, cached)
    return cached.vector
  }

  private cacheEmbedding(id: MemoryIdType, revision: number, vector: readonly number[]): void {
    this.cache.delete(id)
    this.cache.set(id, { revision, vector })
    while (this.cache.size > this.config.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as MemoryIdType
      this.cache.delete(oldest)
    }
  }

  private async embed(inputs: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    using requestDeadline = deadline(signal, this.config.timeoutMs, SEMANTIC_TIMEOUT_CODE)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          input: inputs,
          truncate: false,
          dimensions: this.config.dimensions,
        }),
        signal: requestDeadline.signal,
      })
      if (!response.ok) throw new SemanticSearchError('HTTP_ERROR')
      const body = await readBoundedText(response, this.config.maxResponseBytes, requestDeadline.signal)
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        throw new SemanticSearchError('INVALID_RESPONSE')
      }
      return validateEmbeddingResponse(parsed, inputs.length, this.config.dimensions)
    } catch (error: unknown) {
      if (error instanceof SemanticSearchError) throw error
      if (timeoutOf(requestDeadline.signal, SEMANTIC_TIMEOUT_CODE) !== undefined) {
        throw new SemanticSearchError('TIMEOUT')
      }
      if (signal?.aborted === true) throw abortReason(signal)
      throw new SemanticSearchError('TRANSPORT')
    }
  }
}

async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) throw new SemanticSearchError('RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      if (signal.aborted) throw abortReason(signal)
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new SemanticSearchError('RESPONSE_TOO_LARGE')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function validateEmbeddingResponse(
  value: unknown,
  expectedCount: number,
  expectedDimensions: number,
): readonly (readonly number[])[] {
  if (value === null || typeof value !== 'object') throw new SemanticSearchError('INVALID_RESPONSE')
  const embeddings: unknown = (value as { embeddings?: unknown }).embeddings
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new SemanticSearchError('INVALID_RESPONSE')
  }
  const validated: number[][] = []
  for (const vector of embeddings) {
    if (!Array.isArray(vector)
      || vector.length !== expectedDimensions
      || vector.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
      throw new SemanticSearchError('INVALID_RESPONSE')
    }
    validated.push(vector as number[])
  }
  return validated
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index])
    const rightValue = Number(right[index])
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)))
}

function requiredVector(vector: readonly number[] | undefined): readonly number[] {
  /* v8 ignore next -- validated batches and candidate maps guarantee every indexed vector. */
  if (vector === undefined) throw new SemanticSearchError('INVALID_RESPONSE')
  return vector
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('memory semantic search aborted')
}
