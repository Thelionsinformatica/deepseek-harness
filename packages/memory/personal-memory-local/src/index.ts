/** Local durable provider for personal memory over an isolated storage domain. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  MemoryError,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
  type MemoryListRequest,
  type MemoryRecord,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import { LocalMemoryProvider } from '@deepseek-ai/dsh-memory-local'
import {
  type PersonalMemoryCreateRequest,
  type PersonalMemoryForgetRequest,
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
}

export const Config: z<Config> = z.object({
  historyMode: z.union(['v1', 'temporal-v2'] as const).default('temporal-v2'),
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
}

/** Open the isolated domain and register the provider for this fiber lifetime. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const domain = await ctx.storageDomain.open(localPersonalMemoryDomainSpec)
  ctx.effect(() => () => domain.close(), 'personal-memory-local.domainClose')
  const delegate = new LocalMemoryProvider(
    domain.table('memories'),
    undefined,
    undefined,
    config.historyMode ?? 'temporal-v2',
  )
  const provider = new LocalPersonalMemoryProvider(delegate)
  ctx.effect(() => ctx.personalMemory.registerProvider(provider), 'personal-memory-local.registerProvider')
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
