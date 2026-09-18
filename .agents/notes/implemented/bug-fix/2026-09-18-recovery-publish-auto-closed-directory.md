# Agent Note: Recovery publish closed an auto-closed staging directory

Status: implemented

English | [中文](2026-09-18-recovery-publish-auto-closed-directory.zh.md)

## Problem

`publishStaging` enumerated staged entries with `for await` over `await opendir(staging)`, then called `directory.close()` in `finally`. Node's async iterator already closes the `Dir` when iteration completes, so the explicit close threw `ERR_DIR_CLOSED` and every authenticated restore failed at the publication step, leaving staged content behind.

## Decision

Enumeration relies on the async iterator's own close: names are collected, sorted, and renamed into the claimed target without an explicit `close()`. The other `opendir` call sites in `recovery-format.ts` already follow this pattern.

## Verification

`apps/cli/tests/recovery.spec.ts` passes all 10 tests, including the concurrent restore that expects exactly one winner and the stale-lock path. These are keyless tests; they do not prove recovery of a specific user backup.

## Alternatives considered

Manual `read()` iteration would add bookkeeping for no benefit. Swallowing the close error would hide real publication failures and leave staged data unaccounted for.

## Consequences

Encrypted restore publication works end to end. The exclusive `mkdir` claim, byte authentication before staging, cooperative restore locks, and the no-replace/no-merge guarantees are unchanged.
