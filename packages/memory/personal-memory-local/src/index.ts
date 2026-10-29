/** Local durable provider for personal memory over an isolated storage domain. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  MemoryError,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
  type MemoryGraphRequest,
  type MemoryIdType,
  type MemoryListRequest,
  type MemoryRecord,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  LocalMemoryProvider,
  MemoryGraphScheduler,
  OllamaSemanticIndex,
  resolveSemanticConfig,
  validateMemoryGraphLinkingConfig,
  type LocalMemoryGraph,
  type LocalMemoryRecord,
  type MemoryGraphConfig,
  type SemanticEmbeddingApi,
} from '@deepseek-ai/dsh-memory-local'
import {
  type PersonalMemoryCreateRequest,
  type PersonalMemoryForgetRequest,
  type PersonalMemoryGraphRequest,
  type PersonalMemoryGraphSnapshot,
  type PersonalMemoryListPage,
  type PersonalMemoryListRequest,
  type PersonalMemoryOwnerIdentity,
  type PersonalMemoryProvider,
  type PersonalMemoryRecord,
  type PersonalMemorySearchHit,
  type PersonalMemorySearchRequest,
  type PersonalMemoryUpdateRequest,
} from '@deepseek-ai/dsh-personal-memory'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { localPersonalMemoryDomainSpec } from './spec.ts'

export { localPersonalMemoryDomainSpec } from './spec.ts'

export const name = 'personal-memory-local'
export const inject = ['personalMemory', 'storageDomain']

/** Local history policy. Personal and workspace domains remain independent. */
export interface Config {
  /** Revision policy; `v1` is the emergency in-place overwrite rollback. */
  readonly historyMode?: 'v1' | 'temporal-v2'
  /** Loopback embedding endpoint used only for derived graph edges. */
  readonly embeddings?: PersonalEmbeddingsConfig
  /** Derived similarity-graph policy for owner partitions. */
  readonly linking?: PersonalLinkingConfig
}

/** Loopback embedding transport; deployments must ensure the local endpoint does not proxy remotely. */
export interface PersonalEmbeddingsConfig {
  /** Absolute credential-free loopback HTTP origin of the embedding server. */
  readonly baseUrl?: string
  /** Embedding model name sent to the endpoint. */
  readonly model?: string
  /** Expected vector width; mismatched responses are rejected. */
  readonly dimensions?: number
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum cached revision embeddings retained in memory. */
  readonly maxCacheEntries?: number
  /** Maximum embedding response body bytes accepted. */
  readonly maxResponseBytes?: number
  /** Wire dialect: Ollama `/api/embed` or OpenAI-compatible `/v1/embeddings`. */
  readonly api?: SemanticEmbeddingApi
  /** Maximum graph input characters per chunk; source facts remain complete. */
  readonly graphInputCharacters?: number
  /** Maximum graph input chunks in one embedding request. */
  readonly graphBatchInputs?: number
  /** Maximum subdivisions of an oversized singleton graph chunk. */
  readonly graphInputSplitDepth?: number
  /** Total deadline in milliseconds for one complete graph embedding pass. */
  readonly graphTimeoutMs?: number
}

/** Bounded edge-derivation policy; owner partitions are computed independently. */
export interface PersonalLinkingConfig {
  /** Master switch; derived edges exist only while enabled. */
  readonly enabled?: boolean
  /** Minimum cosine similarity an edge must reach to be published. */
  readonly minScore?: number
  /** Maximum edges retained per memory node, highest score first. */
  readonly maxEdgesPerNode?: number
  /** Maximum active memories embedded per rebuild; excess is skipped. */
  readonly maxGraphNodes?: number
  /** Maximum edge-expansion hits appended to lexical search results. */
  readonly maxExpandedHits?: number
  /** Quiet period after a committed mutation before a rebuild starts. */
  readonly debounceMs?: number
  /** Additional attempts for transient failures in one graph generation. */
  readonly retryAttempts?: number
  /** Initial exponential retry delay in milliseconds. */
  readonly retryDelayMs?: number
  /** Maximum retry delay in milliseconds. */
  readonly retryMaxDelayMs?: number
}

export const Config: z<Config> = z.object({
  historyMode: z.union(['v1', 'temporal-v2'] as const).default('temporal-v2'),
  embeddings: z.object({
    baseUrl: z.string().default('http://127.0.0.1:11434'),
    model: z.string().default('nomic-embed-text:latest'),
    dimensions: z.number().default(768),
    timeoutMs: z.number().default(10_000),
    maxCacheEntries: z.number().default(2_000),
    maxResponseBytes: z.number().default(8_000_000),
    api: z.union(['ollama', 'openai-compatible'] as const).default('ollama'),
    graphInputCharacters: z.number().default(1024),
    graphBatchInputs: z.number().default(8),
    graphInputSplitDepth: z.number().default(8),
    graphTimeoutMs: z.number().default(60_000),
  }),
  linking: z.object({
    enabled: z.boolean().default(false),
    minScore: z.number().default(0.72),
    maxEdgesPerNode: z.number().default(5),
    maxGraphNodes: z.number().default(200),
    maxExpandedHits: z.number().default(4),
    debounceMs: z.number().default(2_000),
    retryAttempts: z.number().default(3),
    retryDelayMs: z.number().default(1_000),
    retryMaxDelayMs: z.number().default(30_000),
  }),
})

/** Adapter that reuses the proven local CAS engine without exposing a synthetic workspace scope. */
export class LocalPersonalMemoryProvider implements PersonalMemoryProvider {
  readonly id = 'local'

  constructor(private readonly delegate: LocalMemoryProvider) {}

  available(): boolean {
    return this.delegate.available()
  }

  async create(
    request: PersonalMemoryCreateRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryRecord> {
    const record = await this.delegate.create(toWorkspaceCreate(request), signal)
    return toPersonalRecord(record, request.scope.ownerId)
  }

  async search(
    request: PersonalMemorySearchRequest,
    signal?: AbortSignal,
  ): Promise<readonly PersonalMemorySearchHit[]> {
    const hits = await this.delegate.search(toWorkspaceSearch(request), signal)
    return hits.map(hit => ({
      score: hit.score,
      record: toPersonalRecord(hit.record, request.scope.ownerId),
    }))
  }

  async list(
    request: PersonalMemoryListRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryListPage> {
    const page = await this.delegate.list(toWorkspaceList(request), signal)
    return {
      ...page,
      items: page.items.map(item => ({
        status: item.status,
        record: toPersonalRecord(item.record, request.scope.ownerId),
      })),
    }
  }

  async update(
    request: PersonalMemoryUpdateRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryRecord> {
    try {
      const record = await this.delegate.update(toWorkspaceUpdate(request), signal)
      return toPersonalRecord(record, request.scope.ownerId)
    } catch (error: unknown) {
      throw translateError(error)
    }
  }

  async forget(request: PersonalMemoryForgetRequest, signal?: AbortSignal): Promise<void> {
    try {
      await this.delegate.forget(toWorkspaceForget(request), signal)
    } catch (error: unknown) {
      throw translateError(error)
    }
  }

  /**
   * Read the derived similarity graph of one owner partition, projecting away the synthetic workspace.
   * @param request - Owner scope whose graph is requested.
   * @param signal - Optional caller cancellation.
   * @returns the owner-scoped snapshot projection.
   */
  async graph(
    request: PersonalMemoryGraphRequest,
    signal?: AbortSignal,
  ): Promise<PersonalMemoryGraphSnapshot> {
    const snapshot = await this.delegate.graph(toWorkspaceGraph(request), signal)
    return {
      ownerId: request.scope.ownerId,
      status: snapshot.status,
      generation: snapshot.generation,
      algorithmVersion: snapshot.algorithmVersion,
      recordRevisions: snapshot.recordRevisions,
      edges: snapshot.edges,
      ...(snapshot.model === undefined ? {} : { model: snapshot.model }),
      ...(snapshot.computedAt === undefined ? {} : { computedAt: snapshot.computedAt }),
      ...(snapshot.failureCode === undefined ? {} : { failureCode: snapshot.failureCode }),
    }
  }
}

/** Open the isolated domain and register the provider for this fiber lifetime. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  validateMemoryGraphLinkingConfig(config.linking)
  // Validate the same transport bounds as workspace memory before opening storage.
  resolveSemanticConfig({ ...config.embeddings, dimensions: config.embeddings?.dimensions ?? 768 })
  const domain = await ctx.storageDomain.open(localPersonalMemoryDomainSpec)
  const graph = resolveGraph(ctx, config, domain.table('graph'), domain.table('memories'))
  ctx.effect(() => async () => {
    await graph?.dispose()
    await domain.close()
  }, 'personal-memory-local.domainClose')
  const delegate = new LocalMemoryProvider(
    domain.table('memories'),
    undefined,
    undefined,
    config.historyMode ?? 'temporal-v2',
    graph,
    config.linking?.maxExpandedHits ?? 4,
  )
  const provider = new LocalPersonalMemoryProvider(delegate)
  ctx.effect(() => ctx.personalMemory.registerProvider(provider), 'personal-memory-local.registerProvider')
}

function resolveGraph(
  ctx: Context,
  config: Config,
  graphTable: KvTable<WorkspaceId, LocalMemoryGraph>,
  memories: KvTable<MemoryIdType, LocalMemoryRecord>,
): MemoryGraphScheduler | undefined {
  if (config.linking?.enabled !== true) return undefined
  const embeddings = config.embeddings
  const resolved = resolveSemanticConfig({ ...embeddings, dimensions: embeddings?.dimensions ?? 768 })
  const index = new OllamaSemanticIndex(resolved)
  const graphConfig: MemoryGraphConfig = {
    enabled: true,
    minScore: config.linking.minScore ?? 0.72,
    maxEdgesPerNode: config.linking.maxEdgesPerNode ?? 5,
    maxGraphNodes: config.linking.maxGraphNodes ?? 200,
    debounceMs: config.linking.debounceMs ?? 2_000,
    model: resolved.model,
    api: resolved.api ?? 'ollama',
    historyMode: config.historyMode ?? 'temporal-v2',
    retryAttempts: config.linking.retryAttempts ?? 3,
    retryDelayMs: config.linking.retryDelayMs ?? 1_000,
    retryMaxDelayMs: config.linking.retryMaxDelayMs ?? 30_000,
  }
  const scheduler = new MemoryGraphScheduler(
    graphTable,
    memories,
    index,
    graphConfig,
    (event) => {
      ctx.emit('memory/graph', { ...event, schemaVersion: 1 })
    },
  )
  void scheduler.setEnabled(ctx.personalMemory.isEnabled())
  ctx.on('personal-memory/enabled', ({ enabled }) => { void scheduler.setEnabled(enabled) })
  scheduler.seedExisting()
  return scheduler
}

function workspaceId(ownerId: PersonalMemoryOwnerIdentity): WorkspaceId {
  return WorkspaceId(`personal:${String(ownerId)}`)
}

function toWorkspaceCreate(request: PersonalMemoryCreateRequest): MemoryCreateRequest {
  return { ...request, scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toWorkspaceSearch(request: PersonalMemorySearchRequest): MemorySearchRequest {
  return { ...request, scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toWorkspaceList(request: PersonalMemoryListRequest): MemoryListRequest {
  return { ...request, scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toWorkspaceUpdate(request: PersonalMemoryUpdateRequest): MemoryUpdateRequest {
  return { ...request, scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toWorkspaceForget(request: PersonalMemoryForgetRequest): MemoryForgetRequest {
  return { ...request, scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toWorkspaceGraph(request: PersonalMemoryGraphRequest): MemoryGraphRequest {
  return { scope: { workspaceId: workspaceId(request.scope.ownerId) } }
}

function toPersonalRecord(
  record: MemoryRecord,
  ownerId: PersonalMemoryOwnerIdentity,
): PersonalMemoryRecord {
  return { ...record, scope: { ownerId } }
}

function translateError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const code = (error as { code?: unknown }).code
  if (code === 'MEMORY_NOT_FOUND') {
    return new MemoryError('personal memory was not found for this local owner', 'PERSONAL_MEMORY_NOT_FOUND')
  }
  if (code === 'MEMORY_REVISION_CONFLICT') {
    return new MemoryError(error.message, 'PERSONAL_MEMORY_REVISION_CONFLICT')
  }
  return error
}
