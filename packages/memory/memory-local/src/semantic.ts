/** Local Ollama embedding transport and bounded in-process semantic index. @module @deepseek-ai/dsh-memory-local/semantic */

import type { MemoryIdType, MemoryRecord } from '@deepseek-ai/dsh-memory'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

const SEMANTIC_TIMEOUT_CODE = 'MEMORY_SEMANTIC_TIMEOUT'

/** Stable reasons why semantic retrieval can fall back to lexical ranking. */
export type SemanticFallbackCode =
  | 'TIMEOUT'
  | 'TRANSPORT'
  | 'HTTP_ERROR'
  | 'INPUT_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'

/** Embedding endpoint dialect; `ollama` uses `/api/embed`, `openai-compatible` uses `/v1/embeddings`. */
export type SemanticEmbeddingApi = 'ollama' | 'openai-compatible'

/** Fully validated transport and cache policy for the local semantic index. */
export interface OllamaSemanticIndexConfig {
  readonly baseUrl: string
  readonly model: string
  readonly dimensions: number
  readonly timeoutMs: number
  readonly maxCacheEntries: number
  readonly maxResponseBytes: number
  readonly api?: SemanticEmbeddingApi
  /** Maximum document characters per graph embedding chunk, excluding its task prefix. */
  readonly graphInputCharacters?: number
  /** Maximum graph chunks in one embedding request. */
  readonly graphBatchInputs?: number
  /** Maximum binary subdivisions of a rejected singleton graph chunk. */
  readonly graphInputSplitDepth?: number
  /** Total deadline for one graph embedding pass, including adaptive subdivision. */
  readonly graphTimeoutMs?: number
}

/** Ranked candidate input whose public record retains workspace source. */
export interface SemanticCandidate {
  readonly record: MemoryRecord
}

/** Minimal pairwise-link input; the table key supplies the stable id. */
export interface SemanticLinkCandidate {
  readonly id: MemoryIdType
  readonly revision: number
  readonly content: string
}

/** One derived similarity edge between two exact candidate revisions. */
export interface SemanticEdge {
  readonly a: MemoryIdType
  readonly b: MemoryIdType
  readonly score: number
}

/** Derived edges and cost counters for one bounded pairwise pass. */
export interface SemanticLinking {
  readonly edges: readonly SemanticEdge[]
  readonly embeddedCount: number
  readonly cacheHitCount: number
  readonly durationMs: number
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
  readonly purpose: 'retrieval' | 'graph'
  readonly vector: readonly number[]
}

/** Sanitized transport failure consumed by the lexical fallback path. */
export class SemanticSearchError extends Error {
  override name = 'SemanticSearchError'

  /**
   * @param code - Stable fallback class safe for telemetry.
   * @param retryable - Whether a bounded graph retry may recover a transient HTTP failure.
   */
  constructor(readonly code: SemanticFallbackCode, readonly retryable = false) {
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
    this.endpoint = config.api === 'openai-compatible'
      ? new URL('/v1/embeddings', config.baseUrl)
      : new URL('/api/embed', config.baseUrl)
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
   * Derive pairwise similarity edges over one bounded candidate set.
   * @param candidates - Records already filtered to one scope and bounded by policy.
   * @param minScore - Inclusive cosine threshold for an edge.
   * @param maxPerNode - Maximum edges retained per candidate; strongest survive.
   * @param signal - Optional caller cancellation.
   * @returns edges ordered by descending score plus cache/latency counters.
   */
  async link(
    candidates: readonly SemanticLinkCandidate[],
    minScore: number,
    maxPerNode: number,
    signal?: AbortSignal,
  ): Promise<SemanticLinking> {
    const startedAt = Date.now()
    if (candidates.length < 2) {
      return { edges: [], embeddedCount: 0, cacheHitCount: 0, durationMs: 0 }
    }
    const missing: SemanticLinkCandidate[] = []
    const vectors = new Map<MemoryIdType, readonly number[]>()
    for (const candidate of candidates) {
      const cached = this.takeCached(candidate.id, candidate.revision, 'graph')
      if (cached === undefined) missing.push(candidate)
      else vectors.set(candidate.id, cached)
    }
    if (missing.length > 0) {
      const embedded = await this.embedGraphDocuments(missing.map(candidate => candidate.content), signal)
      for (const [index, candidate] of missing.entries()) {
        const vector = requiredVector(embedded[index])
        vectors.set(candidate.id, vector)
        this.cacheEmbedding(candidate.id, candidate.revision, vector, 'graph')
      }
    }
    const scored: SemanticEdge[] = []
    for (const [leftIndex, a] of candidates.entries()) {
      for (const b of candidates.slice(leftIndex + 1)) {
        const score = cosine(requiredVector(vectors.get(a.id)), requiredVector(vectors.get(b.id)))
        if (score >= minScore) {
          scored.push(String(a.id) < String(b.id) ? { a: a.id, b: b.id, score } : { a: b.id, b: a.id, score })
        }
      }
    }
    scored.sort((left, right) => right.score - left.score)
    const degree = new Map<MemoryIdType, number>()
    const edges: SemanticEdge[] = []
    for (const edge of scored) {
      const degreeA = degree.get(edge.a) ?? 0
      const degreeB = degree.get(edge.b) ?? 0
      if (degreeA >= maxPerNode || degreeB >= maxPerNode) continue
      degree.set(edge.a, degreeA + 1)
      degree.set(edge.b, degreeB + 1)
      edges.push(edge)
    }
    return {
      edges,
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

  private takeCached(id: MemoryIdType, revision: number, purpose: CachedEmbedding['purpose'] = 'retrieval'): readonly number[] | undefined {
    const cached = this.cache.get(id)
    if (cached === undefined || cached.revision !== revision || cached.purpose !== purpose) {
      this.cache.delete(id)
      return undefined
    }
    this.cache.delete(id)
    this.cache.set(id, cached)
    return cached.vector
  }

  private cacheEmbedding(id: MemoryIdType, revision: number, vector: readonly number[], purpose: CachedEmbedding['purpose'] = 'retrieval'): void {
    this.cache.delete(id)
    this.cache.set(id, { revision, vector, purpose })
    while (this.cache.size > this.config.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as MemoryIdType
      this.cache.delete(oldest)
    }
  }

  /** Complete documents contribute length-weighted means; no source character is discarded. */
  private async embedGraphDocuments(contents: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    using passDeadline = deadline(signal, this.config.graphTimeoutMs ?? 60_000, SEMANTIC_TIMEOUT_CODE)
    try {
      return await this.embedGraphInputs(contents, passDeadline.signal)
    } catch (error) {
      if (timeoutOf(passDeadline.signal, SEMANTIC_TIMEOUT_CODE) !== undefined) throw new SemanticSearchError('TIMEOUT')
      throw error
    }
  }

  private async embedGraphInputs(contents: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]> {
    const maximum = this.config.graphInputCharacters ?? 1024
    const batchSize = this.config.graphBatchInputs ?? 8
    const aggregates = contents.map(text => ({ text,
      sum: Array.from({ length: this.config.dimensions }, () => 0), weight: 0 }))
    const chunks: Array<{ document: typeof aggregates[number]; text: string }> = []
    for (const document of aggregates) {
      const { text } = document
      let start = 0
      do {
        let end = Math.min(text.length, start + maximum)
        if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--
        chunks.push({ document, text: text.slice(start, end) })
        start = end
      } while (start < text.length)
    }
    for (let start = 0; start < chunks.length; start += batchSize) {
      if (signal.aborted) throw abortReason(signal)
      const batch = chunks.slice(start, start + batchSize)
      const vectors = await this.embedGraphBatch(batch.map(chunk => chunk.text), signal)
      for (const [index, chunk] of batch.entries()) {
        const vector = requiredVector(vectors[index])
        const weight = Math.max(1, chunk.text.length)
        const { sum } = chunk.document
        for (const [axis, value] of vector.entries()) sum[axis] = Number(sum[axis]) + value * weight
        chunk.document.weight += weight
      }
    }
    return aggregates.map(({ sum, weight }) => sum.map(value => value / weight))
  }

  /** Split rejected batches before subdividing individual documents, with a finite depth bound. */
  private async embedGraphBatch(texts: readonly string[], signal?: AbortSignal, depth = 0): Promise<readonly (readonly number[])[]> {
    throwIfAborted(signal)
    try {
      return await this.embed(texts.map(text => `search_document: ${text}`), signal)
    } catch (error) {
      if (!(error instanceof SemanticSearchError) || error.code !== 'INPUT_TOO_LARGE') throw error
      throwIfAborted(signal)
      if (texts.length > 1) {
        const middle = Math.ceil(texts.length / 2)
        return [
          ...await this.embedGraphBatch(texts.slice(0, middle), signal, depth),
          ...await this.embedGraphBatch(texts.slice(middle), signal, depth),
        ]
      }
      const text = texts[0]
      if (text === undefined) throw error
      if (depth >= (this.config.graphInputSplitDepth ?? 8) || text.length < 2) throw error
      let middle = Math.floor(text.length / 2)
      if (isHighSurrogate(text.charCodeAt(middle - 1))) middle++
      if (middle >= text.length) throw error
      const left = requiredVector((await this.embedGraphBatch([text.slice(0, middle)], signal, depth + 1))[0])
      const right = requiredVector((await this.embedGraphBatch([text.slice(middle)], signal, depth + 1))[0])
      return [left.map((value, axis) => (value * middle + Number(right[axis]) * (text.length - middle)) / text.length)]
    }
  }

  private async embed(inputs: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    using requestDeadline = deadline(signal, this.config.timeoutMs, SEMANTIC_TIMEOUT_CODE)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: this.config.api === 'openai-compatible'
          ? JSON.stringify({ model: this.config.model, input: inputs })
          : JSON.stringify({
            model: this.config.model,
            input: inputs,
            truncate: false,
            dimensions: this.config.dimensions,
          }),
        signal: requestDeadline.signal,
      })
      const body = await readBoundedText(response, this.config.maxResponseBytes, requestDeadline.signal)
      if (!response.ok) {
        const code = classifyEmbeddingHttpError(response.status, body)
        throw new SemanticSearchError(code, code !== 'INPUT_TOO_LARGE'
          && [408, 429, 500, 502, 503, 504].includes(response.status))
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        throw new SemanticSearchError('INVALID_RESPONSE')
      }
      return this.config.api === 'openai-compatible'
        ? validateOpenAIEmbeddingResponse(parsed, inputs.length, this.config.dimensions)
        : validateEmbeddingResponse(parsed, inputs.length, this.config.dimensions)
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

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

/** Recognize explicit context/batch overflow without retaining or exposing provider detail. */
function classifyEmbeddingHttpError(status: number, body: string): 'HTTP_ERROR' | 'INPUT_TOO_LARGE' {
  if (![400, 413, 422, 500].includes(status)) return 'HTTP_ERROR'
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return 'HTTP_ERROR'
  }
  if (value === null || typeof value !== 'object' || !('error' in value)) return 'HTTP_ERROR'
  const detail = value.error
  const message = typeof detail === 'string' ? detail
    : detail !== null && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
      ? detail.message : ''
  if (detail !== null && typeof detail === 'object') {
    const overflowCodes = ['context_length_exceeded', 'context_window_exceeded', 'exceed_context_size_error']
    if (('code' in detail && typeof detail.code === 'string' && overflowCodes.includes(detail.code))
      || ('type' in detail && typeof detail.type === 'string' && overflowCodes.includes(detail.type))) {
      return 'INPUT_TOO_LARGE'
    }
  }
  const physicalBatch = /^input \(\d+ tokens\) is too large to process\. increase the physical batch size \(current batch size: \d+\)$/i
  const contextSize = /^(?:input|request) \(\d+ tokens\) exceeds the available context size \(\d+ tokens\)(?:, try increasing it)?$/i
  const contextLength = /^(?:the )?input length exceeds (?:the |maximum )?context length\.?$/i
  return physicalBatch.test(message) || contextSize.test(message) || contextLength.test(message)
    ? 'INPUT_TOO_LARGE' : 'HTTP_ERROR'
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

function validateOpenAIEmbeddingResponse(
  value: unknown,
  expectedCount: number,
  expectedDimensions: number,
): readonly (readonly number[])[] {
  if (value === null || typeof value !== 'object') throw new SemanticSearchError('INVALID_RESPONSE')
  const data: unknown = (value as { data?: unknown }).data
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new SemanticSearchError('INVALID_RESPONSE')
  }
  const byIndex = new Map<number, readonly number[]>()
  for (const row of data as readonly unknown[]) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
      || !('index' in row) || typeof row.index !== 'number' || !Number.isInteger(row.index)
      || row.index < 0 || row.index >= expectedCount || byIndex.has(row.index)
      || !('embedding' in row)) {
      throw new SemanticSearchError('INVALID_RESPONSE')
    }
    const validated = validateEmbeddingResponse({ embeddings: [row.embedding] }, 1, expectedDimensions)
    byIndex.set(row.index, requiredVector(validated[0]))
  }
  return Array.from({ length: expectedCount }, (_value, index) => requiredVector(byIndex.get(index)))
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

/** Re-read cancellation after awaits without retaining TypeScript's pre-await narrowing. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('memory semantic search aborted')
}
