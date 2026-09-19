/**
 * Portable continuity layer for local DSH memory.
 *
 * This package exports complete lineage records from local storage-domain tables,
 * imports them idempotently into another compatible medium, and returns
 * operation journal entries whose persistence remains caller-owned.
 *
 * It intentionally does not replace `memory-local` or introduce a second memory
 * runtime. The durable shape remains owned by `@deepseek-ai/dsh-memory-local`.
 *
 * @module @deepseek-ai/dsh-memory-continuity
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { MemoryId, type MemoryId as MemoryIdentity } from '@deepseek-ai/dsh-memory'
import { localMemoryRecord, type LocalMemoryRecord } from '@deepseek-ai/dsh-memory-local'

export { localMemoryRecord } from '@deepseek-ai/dsh-memory-local'
export type { LocalMemoryRecord, LocalMemoryVersion } from '@deepseek-ai/dsh-memory-local'

/** Stable continuity snapshot schema version. */
export const MEMORY_CONTINUITY_SCHEMA_VERSION = 1 as const

/** One local memory domain included in a portable snapshot. */
export interface MemoryContinuityDomainSnapshot {
  readonly name: string
  readonly version: number
  readonly table: string
  readonly records: ReadonlyArray<readonly [MemoryIdentity, LocalMemoryRecord]>
  readonly checksum: string
}

/** Append-only journal entry; content is intentionally not duplicated. */
export interface MemoryContinuityJournalEntry {
  readonly journalId: string
  readonly schemaVersion: typeof MEMORY_CONTINUITY_SCHEMA_VERSION
  readonly recordedAt: string
  readonly operation: 'export' | 'import'
  readonly domains: readonly string[]
  readonly recordCount: number
  readonly checksum: string
  readonly provenance: {
    readonly reason?: string
    readonly source?: string
  }
}

/** Portable deterministic memory snapshot. */
export interface MemoryContinuitySnapshot {
  readonly schemaVersion: typeof MEMORY_CONTINUITY_SCHEMA_VERSION
  readonly exportedAt: string
  readonly format: 'dsh-memory-continuity/json'
  readonly domains: readonly MemoryContinuityDomainSnapshot[]
  readonly checksum: string
}

/** Import result with deterministic counters for audit. */
export interface MemoryContinuityImportResult {
  readonly imported: number
  readonly skippedExisting: number
  readonly journalEntry: MemoryContinuityJournalEntry
}

/** One domain that can be exported/imported. */
export interface MemoryContinuityDomainSource {
  readonly name: string
  readonly version: number
  readonly table: string
  readonly records: Iterable<readonly [MemoryIdentity, LocalMemoryRecord]>
}

/** Write-side domain selected for idempotent restore. */
export interface MemoryContinuityDomainTarget {
  readonly name: string
  readonly version: number
  readonly table: KvTable<MemoryIdentity, LocalMemoryRecord>
}

/** Small provider-neutral table adapter useful for direct tests and host integrations. */
export class MemoryContinuityTable implements KvTable<MemoryIdentity, LocalMemoryRecord> {
  private readonly records = new Map<MemoryIdentity, LocalMemoryRecord>()

  entries(): IterableIterator<[MemoryIdentity, LocalMemoryRecord]> {
    return this.records.entries()
  }

  keys(): IterableIterator<MemoryIdentity> {
    return this.records.keys()
  }

  get size(): number {
    return this.records.size
  }

  get(key: MemoryIdentity): LocalMemoryRecord | undefined {
    return this.records.get(key)
  }

  put(key: MemoryIdentity, value: LocalMemoryRecord): Promise<void> {
    return new Promise((resolve) => {
      this.records.set(key, localMemoryRecord.parse(value))
      resolve()
    })
  }

  /** @param update - Computes the replacement from the current record; failures reject without writing. */
  update(key: MemoryIdentity, update: (current: LocalMemoryRecord) => LocalMemoryRecord): Promise<LocalMemoryRecord> {
    return new Promise((resolve) => {
      const current = this.records.get(key)
      if (current === undefined) throw new Error(`memory continuity record '${String(key)}' was not found`)
      const next = localMemoryRecord.parse(update(current))
      this.records.set(key, next)
      resolve(next)
    })
  }

  delete(key: MemoryIdentity): Promise<boolean> {
    return Promise.resolve(this.records.delete(key))
  }

  mutate<R>(key: MemoryIdentity, fn: (current: LocalMemoryRecord | undefined) => import('@deepseek-ai/dsh-storage-domain').KvRecordMutation<LocalMemoryRecord, R>): Promise<R> {
    return new Promise((resolve) => {
      const decision = fn(this.records.get(key))
      if (decision.kind === 'put') {
        this.records.set(key, localMemoryRecord.parse(decision.value))
      }
      resolve(decision.result)
    })
  }
}

/** Provider-neutral exporter for local memory lineage. */
export class MemoryContinuityProvider {
  /** Stable provider identifier for caller-owned registries. */
  readonly id: string = 'memory-continuity'

  /**
   * Build a snapshot without mutating the source tables; invalid records throw.
   * @param domains - Caller-selected domains and their complete records.
   * @param options - Optional timestamp; defaults to the current time.
   * @returns A checksummed snapshot; journal persistence remains caller-owned.
   */
  export(domains: readonly MemoryContinuityDomainSource[], options: { readonly exportedAt?: string } = {}): MemoryContinuitySnapshot {
    const snapshots = domains.map((domain) => {
      const records = [...domain.records]
        .map(([id, record]) => [MemoryId(String(id)), localMemoryRecord.parse(record)] as const)
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      return Object.freeze({
        name: domain.name,
        version: domain.version,
        table: domain.table,
        records: Object.freeze(records),
        checksum: checksum(records),
      })
    })
    const snapshot: MemoryContinuitySnapshot = Object.freeze({
      schemaVersion: MEMORY_CONTINUITY_SCHEMA_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      format: 'dsh-memory-continuity/json',
      domains: Object.freeze(snapshots),
      checksum: checksum(snapshots),
    })
    return snapshot
  }

  /**
   * Validate every destination before writing, then atomically insert only missing ids.
   * Storage failures may leave earlier writes committed; repeating the same import skips them.
   * @param snapshot - Snapshot with valid checksums and local memory records.
   * @param targets - Destination tables with matching domain names and versions.
   * @returns Import counters and a journal entry that the caller must persist.
   */
  async import(
    snapshot: MemoryContinuitySnapshot,
    targets: readonly MemoryContinuityDomainTarget[],
  ): Promise<MemoryContinuityImportResult> {
    snapshot = parseSnapshot(serializeSnapshot(snapshot))
    const byName = new Map(targets.map(target => [target.name, target]))
    if (byName.size !== targets.length) throw new Error('memory continuity duplicate target name')
    const names = new Set<string>()
    const plan = snapshot.domains.map((domain) => {
      if (names.has(domain.name)) throw new Error('memory continuity duplicate domain name')
      names.add(domain.name)
      const target = byName.get(domain.name)
      if (target === undefined) throw new Error(`memory continuity target '${domain.name}' is not registered`)
      if (target.version !== domain.version) {
        throw new Error(`memory continuity domain '${domain.name}' is v${domain.version}, target wants v${target.version}`)
      }
      if (new Set(domain.records.map(([id]) => id)).size !== domain.records.length) {
        throw new Error(`memory continuity duplicate record id in '${domain.name}'`)
      }
      return { domain, table: target.table }
    })
    let imported = 0
    let skippedExisting = 0
    for (const { domain, table } of plan) {
      for (const [id, record] of domain.records) {
        try {
          const inserted = await table.mutate(id, current => current === undefined
            ? { kind: 'put', value: record, result: true }
            : { kind: 'keep', result: false })
          if (inserted) imported += 1
          else skippedExisting += 1
        } catch (cause) {
          throw new Error('Memory import incomplete; retry the same snapshot after repairing storage. Existing ids are preserved.', { cause })
        }
      }
    }
    const journalEntry = journal('import', snapshot.domains.map(domain => domain.name), imported, snapshot.checksum)
    return Object.freeze({ imported, skippedExisting, journalEntry })
  }
}

/** Register a provider-neutral continuity service on `ctx.memoryContinuity`. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryContinuity: MemoryContinuityProvider
  }
}

/** Host registration point; storage domains remain supplied by callers. */
export function apply(ctx: Context): void {
  const provider = new MemoryContinuityProvider()
  ctx.provide('memoryContinuity', provider)
}

/**
 * Journal an export after successful snapshot construction.
 * @param snapshot - Successfully constructed snapshot to describe.
 * @param reason - Optional caller-supplied audit reason.
 * @returns An unpersisted export journal entry.
 */
export function exportJournal(snapshot: MemoryContinuitySnapshot, reason?: string): MemoryContinuityJournalEntry {
  const recordCount = snapshot.domains.reduce((count, domain) => count + domain.records.length, 0)
  return journal('export', snapshot.domains.map(domain => domain.name), recordCount, snapshot.checksum, reason)
}

/**
 * Compute the stable SHA-256 checksum used by snapshots and journals.
 * @param value - JSON-compatible value to serialize deterministically.
 * @returns Hexadecimal digest of the stable serialization.
 */
export function checksum(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

/**
 * Serialize a snapshot deterministically for file storage; invalid snapshots throw.
 * @param snapshot - Snapshot with valid records and checksums.
 * @returns Stable JSON with a trailing newline.
 */
export function serializeSnapshot(snapshot: MemoryContinuitySnapshot): string {
  validateSnapshot(snapshot)
  return `${stableStringify(snapshot, 2)}\n`
}

/**
 * Parse and validate a previously serialized snapshot; malformed data or checksums throw.
 * @param text - Serialized snapshot JSON.
 * @returns Validated snapshot with branded record IDs.
 */
export function parseSnapshot(text: string): MemoryContinuitySnapshot {
  const raw: unknown = JSON.parse(text)
  assertSnapshotShape(raw)
  const parsed = raw as Omit<MemoryContinuitySnapshot, 'domains'> & {
    domains: Array<Omit<MemoryContinuityDomainSnapshot, 'records'> & {
      records: ReadonlyArray<readonly [string, unknown]>
    }>
  }
  const snapshot: MemoryContinuitySnapshot = {
    ...parsed,
    domains: parsed.domains.map(domain => ({
      ...domain,
      records: domain.records.map(([id, record]) => [MemoryId(id), localMemoryRecord.parse(record)] as const),
    })),
  }
  validateSnapshot(snapshot)
  return snapshot
}

function journal(
  operation: 'export' | 'import',
  domains: readonly string[],
  recordCount: number,
  checksumValue: string,
  reason?: string,
): MemoryContinuityJournalEntry {
  return Object.freeze({
    journalId: randomUUID(),
    schemaVersion: MEMORY_CONTINUITY_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    operation,
    domains: Object.freeze([...domains].sort()),
    recordCount,
    checksum: checksumValue,
    provenance: Object.freeze({
      ...(reason === undefined ? {} : { reason }),
      source: '@deepseek-ai/dsh-memory-continuity',
    }),
  })
}

function validateSnapshot(snapshot: MemoryContinuitySnapshot): void {
  const recomputed = checksum(snapshot.domains)
  if (snapshot.checksum !== recomputed) {
    throw new Error(`memory continuity checksum mismatch: expected ${recomputed}, received ${snapshot.checksum}`)
  }
  for (const domain of snapshot.domains) {
    const domainChecksum = checksum(domain.records)
    if (domain.checksum !== domainChecksum) {
      throw new Error(`memory continuity domain '${domain.name}' checksum mismatch`)
    }
    for (const [, record] of domain.records) localMemoryRecord.parse(record)
  }
}

function assertSnapshotShape(value: unknown): void {
  if (value === null || typeof value !== 'object') throw new TypeError('memory continuity snapshot must be an object')
  const snapshot = value as Record<string, unknown>
  if (snapshot.schemaVersion !== MEMORY_CONTINUITY_SCHEMA_VERSION) throw new TypeError('unsupported memory continuity schema version')
  if (typeof snapshot.exportedAt !== 'string') throw new TypeError('memory continuity exportedAt must be a string')
  if (snapshot.format !== 'dsh-memory-continuity/json') throw new TypeError('unsupported memory continuity format')
  if (typeof snapshot.checksum !== 'string' || snapshot.checksum.length !== 64) throw new TypeError('invalid memory continuity checksum')
  if (!Array.isArray(snapshot.domains)) throw new TypeError('memory continuity domains must be an array')
  for (const domainValue of snapshot.domains) {
    if (domainValue === null || typeof domainValue !== 'object') throw new TypeError('memory continuity domain must be an object')
    const domain = domainValue as Record<string, unknown>
    if (typeof domain.name !== 'string' || domain.name.length === 0) throw new TypeError('invalid continuity domain name')
    if (!Number.isSafeInteger(domain.version) || (domain.version as number) < 1) throw new TypeError('invalid continuity domain version')
    if (typeof domain.table !== 'string' || domain.table.length === 0) throw new TypeError('invalid continuity domain table')
    if (typeof domain.checksum !== 'string' || domain.checksum.length !== 64) throw new TypeError('invalid continuity domain checksum')
    if (!Array.isArray(domain.records)) throw new TypeError('continuity domain records must be an array')
    for (const tuple of domain.records) {
      if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string') {
        throw new TypeError('continuity record tuples must contain an id and record')
      }
      localMemoryRecord.parse(tuple[1])
    }
  }
}

function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortValue(value), null, space)
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, sortValue(input[key])]))
  }
  return value
}
