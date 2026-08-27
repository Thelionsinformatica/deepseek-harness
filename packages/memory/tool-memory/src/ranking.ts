/** Deterministic final ranking over provider-returned workspace memory hits. */

import type { MemorySearchHit, MemoryValidation } from '@deepseek-ai/dsh-memory'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Optional final-ranking policy shared by explicit and automatic recall. */
export interface MemoryRankingConfig {
  /** Apply metadata-aware final scoring; false retains validated provider-score order. */
  readonly enabled?: boolean
  /** Exponential recency half-life in days; must be greater than zero and at most 3,650. */
  readonly halfLifeDays?: number
  /** Non-negative weight for provider relevance normalized within one candidate set. */
  readonly relevanceWeight?: number
  /** Non-negative weight for exponential recency. */
  readonly recencyWeight?: number
  /** Non-negative weight for the record's normalized importance. */
  readonly importanceWeight?: number
  /** Non-negative weight for confirmation class multiplied by source confidence. */
  readonly validationWeight?: number
}

/** Fully validated ranking policy. */
export interface ResolvedMemoryRankingConfig {
  readonly enabled: boolean
  readonly halfLifeDays: number
  readonly relevanceWeight: number
  readonly recencyWeight: number
  readonly importanceWeight: number
  readonly validationWeight: number
}

/**
 * Resolve safe defaults and reject non-deterministic or degenerate score weights.
 * @param input - Optional deployment overrides for the final ranking policy.
 * @returns a complete validated ranking policy.
 */
export function resolveRankingConfig(input: MemoryRankingConfig = {}): ResolvedMemoryRankingConfig {
  const resolved: ResolvedMemoryRankingConfig = {
    enabled: input.enabled ?? true,
    halfLifeDays: input.halfLifeDays ?? 30,
    relevanceWeight: input.relevanceWeight ?? 0.55,
    recencyWeight: input.recencyWeight ?? 0.2,
    importanceWeight: input.importanceWeight ?? 0.15,
    validationWeight: input.validationWeight ?? 0.1,
  }
  if (!Number.isFinite(resolved.halfLifeDays) || resolved.halfLifeDays <= 0 || resolved.halfLifeDays > 3_650) {
    throw new TypeError('tool-memory: ranking halfLifeDays must be a finite number from >0 through 3650')
  }
  for (const [name, value] of [
    ['relevanceWeight', resolved.relevanceWeight],
    ['recencyWeight', resolved.recencyWeight],
    ['importanceWeight', resolved.importanceWeight],
    ['validationWeight', resolved.validationWeight],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`tool-memory: ranking ${name} must be a non-negative finite number`)
    }
  }
  if (resolved.relevanceWeight + resolved.recencyWeight
    + resolved.importanceWeight + resolved.validationWeight === 0) {
    throw new TypeError('tool-memory: ranking weights cannot all be zero')
  }
  return resolved
}

/**
 * Validate, deduplicate, score, and cap provider hits for one exact workspace.
 * @param hits - Provider output, possibly over-fetched for final reranking.
 * @param workspaceId - Mandatory scope that every retained record must match.
 * @param limit - Final number of hits exposed to a tool or model snapshot.
 * @param config - Resolved ranking and rollback policy.
 * @param nowMs - Stable clock sample shared by every hit in this ranking call.
 * @param includeHistory - Retain validated inactive revisions for an explicit audit search.
 * @returns validated, deduplicated, deterministically ordered hits capped to the requested limit.
 */
export function rankMemoryHits(
  hits: readonly MemorySearchHit[],
  workspaceId: WorkspaceId,
  limit: number,
  config: ResolvedMemoryRankingConfig,
  nowMs = Date.now(),
  includeHistory = false,
): MemorySearchHit[] {
  const unique = new Map<string, MemorySearchHit>()
  for (const hit of hits) {
    if (!validHit(hit, workspaceId, nowMs, includeHistory)) continue
    const key = includeHistory
      ? `${String(hit.record.id)}\u0000${String(hit.record.revision)}`
      : String(hit.record.id)
    const current = unique.get(key)
    if (current === undefined || strongerDuplicate(hit, current)) unique.set(key, hit)
  }
  const candidates = [...unique.values()]
  if (!config.enabled) return stableOrder(candidates).slice(0, limit)
  const maxRelevance = Math.max(0, ...candidates.map(hit => hit.score))
  const totalWeight = config.relevanceWeight + config.recencyWeight
    + config.importanceWeight + config.validationWeight
  const ranked = candidates.map((hit): MemorySearchHit => {
    const normalizedRelevance = maxRelevance === 0 ? 0 : Math.max(0, hit.score) / maxRelevance
    // Preserve a strong exact-match advantage over merely recent near-matches.
    // Without this calibration, recency can erase one missing query concept
    // from a months-old decision even when its provider score is the maximum.
    const relevance = normalizedRelevance ** 2
    const ageDays = Math.max(0, nowMs - Date.parse(hit.record.updatedAt)) / 86_400_000
    const recency = 2 ** (-ageDays / config.halfLifeDays)
    const importance = hit.record.importance ?? 0.5
    const validation = validationScore(hit.record.validation) * (hit.record.confidence ?? 1)
    const score = (
      relevance * config.relevanceWeight
      + recency * config.recencyWeight
      + importance * config.importanceWeight
      + validation * config.validationWeight
    ) / totalWeight
    return { record: hit.record, score }
  })
  return stableOrder(ranked).slice(0, limit)
}

function validHit(
  hit: MemorySearchHit,
  workspaceId: WorkspaceId,
  nowMs: number,
  includeHistory: boolean,
): boolean {
  if (!Number.isFinite(hit.score) || hit.record.scope.workspaceId !== workspaceId) return false
  if (hit.record.content.trim().length === 0 || !Number.isSafeInteger(hit.record.revision) || hit.record.revision < 1) {
    return false
  }
  const createdAt = Date.parse(hit.record.createdAt)
  const updatedAt = Date.parse(hit.record.updatedAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) return false
  if (!optionalUnitInterval(hit.record.importance) || !optionalUnitInterval(hit.record.confidence)) return false
  if (!validValidation(hit.record.validation) || !validRef(hit.record.supersedes)
    || !validRef(hit.record.supersededBy)) return false
  const validFrom = optionalDate(hit.record.validFrom)
  const validUntil = optionalDate(hit.record.validUntil)
  const expiresAt = optionalDate(hit.record.expiresAt)
  if (validFrom === false || validUntil === false || expiresAt === false) return false
  if (typeof validFrom === 'number' && typeof validUntil === 'number' && validUntil < validFrom) return false
  if (typeof validFrom === 'number' && typeof expiresAt === 'number' && expiresAt <= validFrom) return false
  if (includeHistory) return true
  if (hit.record.supersededBy !== undefined) return false
  if (typeof validFrom === 'number' && validFrom > nowMs) return false
  if (typeof validUntil === 'number' && validUntil <= nowMs) return false
  return typeof expiresAt !== 'number' || expiresAt > nowMs
}

function optionalDate(value: string | undefined): number | undefined | false {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : false
}

function validRef(ref: MemorySearchHit['record']['supersedes']): boolean {
  return ref === undefined
    || (String(ref.id).length > 0 && Number.isSafeInteger(ref.revision) && ref.revision > 0)
}

function optionalUnitInterval(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)
}

function validValidation(value: unknown): value is MemoryValidation | undefined {
  return value === undefined || value === 'explicit' || value === 'reviewed'
}

function validationScore(value: MemoryValidation | undefined): number {
  if (value === 'reviewed') return 1
  if (value === 'explicit') return 0.9
  return 0.5
}

function strongerDuplicate(candidate: MemorySearchHit, current: MemorySearchHit): boolean {
  if (candidate.record.revision !== current.record.revision) {
    return candidate.record.revision > current.record.revision
  }
  if (candidate.score !== current.score) return candidate.score > current.score
  return candidate.record.updatedAt > current.record.updatedAt
}

function stableOrder(hits: MemorySearchHit[]): MemorySearchHit[] {
  return hits.sort(compareRankedHits)
}

function compareRankedHits(left: MemorySearchHit, right: MemorySearchHit): number {
  const scoreOrder = right.score - left.score
  if (scoreOrder !== 0) return scoreOrder
  const updatedOrder = right.record.updatedAt.localeCompare(left.record.updatedAt)
  if (updatedOrder !== 0) return updatedOrder
  return String(left.record.id).localeCompare(String(right.record.id))
}
