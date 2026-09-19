/** Provider-neutral vocabulary for durable personal memory. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  MemoryCreateRequest,
  MemoryForgetRequest,
  MemoryListItem,
  MemoryListPage,
  MemoryListRequest,
  MemoryRecord,
  MemorySearchHit,
  MemorySearchRequest,
  MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'

/** Stable local owner partition. It is not an account or telemetry identity. */
export type PersonalMemoryOwnerId = Branded<'PersonalMemoryOwnerId'>

/**
 * Brand a validated local owner label. Runtime operations still validate boundaries.
 * @param value - Stable deployment-owned local label.
 * @returns The branded owner identity used as an isolation boundary.
 */
export function PersonalMemoryOwnerId(value: string): PersonalMemoryOwnerId {
  return value as PersonalMemoryOwnerId
}

/** Isolation boundary applied to every personal-memory operation. */
export interface PersonalMemoryScope {
  readonly ownerId: PersonalMemoryOwnerId
}

/** One normalized personal-memory record. */
export type PersonalMemoryRecord = Omit<MemoryRecord, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** Create one personal fact in the explicit local-owner partition. */
export type PersonalMemoryCreateRequest = Omit<MemoryCreateRequest, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** Search only one explicit local-owner partition. */
export type PersonalMemorySearchRequest = Omit<MemorySearchRequest, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** One provider-ranked personal-memory result. */
export interface PersonalMemorySearchHit extends Omit<MemorySearchHit, 'record'> {
  readonly record: PersonalMemoryRecord
}

/** Enumerate one personal-memory partition. */
export type PersonalMemoryListRequest = Omit<MemoryListRequest, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** One listed personal-memory revision. */
export interface PersonalMemoryListItem extends Omit<MemoryListItem, 'record'> {
  readonly record: PersonalMemoryRecord
}

/** Stable page returned by personal-memory administration. */
export interface PersonalMemoryListPage extends Omit<MemoryListPage, 'items'> {
  readonly items: readonly PersonalMemoryListItem[]
}

/** Correct one exact personal-memory revision. */
export type PersonalMemoryUpdateRequest = Omit<MemoryUpdateRequest, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** Forget one exact personal-memory revision. */
export type PersonalMemoryForgetRequest = Omit<MemoryForgetRequest, 'scope'> & {
  readonly scope: PersonalMemoryScope
}

/** Provider contract registered with `ctx.personalMemory`. */
export interface PersonalMemoryProvider {
  readonly id: string
  available(): boolean
  create(request: PersonalMemoryCreateRequest, signal?: AbortSignal): Promise<PersonalMemoryRecord>
  search(request: PersonalMemorySearchRequest, signal?: AbortSignal): Promise<readonly PersonalMemorySearchHit[]>
  list(request: PersonalMemoryListRequest, signal?: AbortSignal): Promise<PersonalMemoryListPage>
  update(request: PersonalMemoryUpdateRequest, signal?: AbortSignal): Promise<PersonalMemoryRecord>
  forget(request: PersonalMemoryForgetRequest, signal?: AbortSignal): Promise<void>
}

/** Content-free operation event for local audit and health reporting. */
export interface PersonalMemoryOperationEvent {
  readonly schemaVersion: 1
  readonly operation: 'create' | 'search' | 'list' | 'update' | 'forget'
  readonly provider: string
  readonly success: boolean
  readonly ownerId: PersonalMemoryOwnerId
  readonly resultCount?: number
  readonly memoryId?: MemoryRecord['id']
  readonly revision?: number
  readonly errorCode?: string
  readonly durationMs?: number
}

/** Sanitized rejection emitted before a personal-memory operation mutates state. */
export interface PersonalMemoryBlockedEvent {
  readonly schemaVersion: 1
  readonly operation: PersonalMemoryOperationEvent['operation']
  readonly ownerId: PersonalMemoryOwnerId
  readonly reason: 'credential-like' | 'disabled' | 'validation' | 'provider'
  readonly errorCode: string
}
