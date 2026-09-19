# Agent Note: Temporal memory history

Status: implemented

English | [中文](2026-08-25-temporal-memory-history.zh.md)

## Problem

Correcting a durable fact previously replaced its value in place. Compare-and-set revision checks prevented stale writes, but the prior fact, its validity interval, and the correcting session were no longer available for audit. Scheduled corrections also require one unambiguous active revision before and after the transition instant.

## Decision

Memory record schema V2 adds optional `validFrom`, `validUntil`, `expiresAt`, `supersedes`, and `supersededBy` metadata while continuing to read schema V1 records. The local provider stores immutable prior revisions inside the same lineage value as the current revision. One serialized storage update therefore commits the new current state and its history atomically.

Normal search resolves only revisions active at the query clock. An immediate correction closes the prior revision at the transition instant; a future correction keeps the prior revision active until the new `validFrom`. Expired, scheduled, malformed, and replaced revisions do not enter normal or automatic recall. Explicit `includeHistory` search returns validated audit revisions through the lexical path and never sends history text to the semantic index.

The shipped Leon composition selects `historyMode: temporal-v2`. `historyMode: v1` is an emergency rollback for future corrections: it resumes in-place overwrite behavior without making existing V2 records unreadable or disabling active-search validity and expiry filters.

## Verification

Tests cover contradictory corrections, multi-revision lineage, scheduled handoff, expiry, explicit expiry removal, legacy V1 reads and updates, malformed temporal media, workspace isolation, atomic write failure, explicit history tool output, automatic active-only recall, and V1 rollback. The nine memory test files pass with 128 cases. Focused coverage for `memory-local` and its durable schema is 100% for statements, branches, functions, and lines.

## Alternatives considered

**A separate history table.** Deferred because committing current state and history would require a cross-table transaction contract that the provider-neutral storage seam does not currently expose.

**Overwrite plus an observability event.** Rejected because logs are not the durable source of truth and cannot reconstruct all stored metadata reliably.

**Send historical revisions through semantic recall.** Rejected because automatic recall must remain active-only, and repeated ids with different revisions complicate semantic-cache identity without helping ordinary conversation.

## Consequences

Leon can change models or restart without losing which durable fact was valid at a given time. Normal responses receive one current fact, while explicit audits can inspect the preserved correction chain. Storage grows with correction count, so retention or compaction policy remains future work.
