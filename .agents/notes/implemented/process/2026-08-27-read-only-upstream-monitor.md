# Agent Note: Keep upstream monitoring read-only

Status: implemented

English | [中文](2026-08-27-read-only-upstream-monitor.zh.md)

## Problem

Leon needs to notice relevant changes in the original harness without allowing an automated update to overwrite local identity, routing, memory, safety, or Windows-integration work. A normal `git fetch` changes repository references, and an automated merge would combine unreviewed upstream behavior with a heavily customized working tree.

## Decision

The root command `pnpm run check:leon-upstream` runs `scripts/check-leon-upstream.ts`. It reads the configured upstream URL, the current commit, the cached `upstream/master` commit, and the live `master` commit returned by `git ls-remote`. It never fetches, merges, rebases, checks out, writes a file, or changes a Git reference.

The result distinguishes an unchanged upstream, a new live commit that requires manual review, and a missing local baseline. `--json` exposes the same result for a future local scheduler, while `--remote` and `--branch` support a deliberate repository-layout change.

## Alternatives considered

**Fetch automatically.** Fetching does not edit source files, but it mutates remote-tracking references and makes a monitoring job part of repository state. The monitor only needs the live object identifier, so `ls-remote` is sufficient.

**Merge automatically.** Rejected because upstream changes can conflict semantically with Leon-specific behavior even when Git reports no textual conflict.

## Consequences

The command can safely run as an observation step and clearly reports when a manual upstream audit is needed. Until an approved fetch refreshes the cached baseline, the command keeps reporting that same live change; this repetition is intentional and prevents an observation from being mistaken for an accepted update.
