# Agent Note: Memory import preflight and retry

Status: implemented

English | [中文](2026-09-06-memory-import-preflight.zh.md)

## Problem

Import could write an earlier domain before discovering that a later target was missing or incompatible. Separate get and put operations also allowed a concurrent import to overwrite an ID that appeared between the two operations.

## Decision

Memory continuity clones and validates the snapshot and resolves every destination before the first write. It rejects duplicate domain names, target names, and record IDs within a domain. Insertion uses KvTable.mutate so only missing IDs are written.

Storage errors reject the import as incomplete. Earlier writes can remain committed; retrying the same snapshot skips existing IDs. Journal persistence belongs to the caller, and no success entry is returned on failure.

## Alternatives considered

**Global rollback:** the table interface has no multi-domain transaction. Compensating deletes could erase concurrent legitimate updates, so import does not promise rollback.

**Get followed by put:** this cannot preserve insert-only semantics under concurrent imports. Conditional mutation owns the check and insertion together.

## Consequences

A fault-injection example intercepts filesystem calls only in a disposable child running the built JSON backend. It exits after a partial temporary write, before rename, or after rename. Fresh Loader processes reopen the expected complete old or new state; abandoned temporary files are observed but not mistaken for committed data. This is deterministic process-failure coverage, not a physical power-loss test.

The restart test includes immediate process exit after an acknowledged write and snapshot export. Absence of a shutdown marker proves disposal was bypassed; fresh processes verify lineage and idempotence. This does not cover termination during an in-flight write or physical power loss.

The disk-backed example verifies graceful process restart and restore through the built JSON backend and domain layer. A separate process refuses an intentionally malformed file without modifying it or the original domain. Power loss during writes and simultaneous multi-process writers remain untested.

Invalid destinations no longer cause partial imports. Storage failure still can, so recovery requires repairing storage and retrying, not assuming all-or-nothing behavior. Existing IDs are preserved even if contents differ.

Tests cover rejection before writes, storage failure and retry, and concurrent imports using an in-memory adapter. A keyless example boots the built package through Loader, exports a file, reimports it, rejects missing targets and verifies service disposal. Registration uses Cordis provide rather than assigning an unregistered context property. These tests do not prove real disk crash recovery, multi-process concurrency or live model switching.
