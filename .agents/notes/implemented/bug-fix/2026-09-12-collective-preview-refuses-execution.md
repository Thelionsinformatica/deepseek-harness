# Agent Note: Collective preview refuses execution

Status: implemented

English | [中文](2026-09-12-collective-preview-refuses-execution.zh.md)

## Problem

A CLI demonstration populated an in-memory board with fabricated deliveries and test outcomes, then appended claimed experience to a JSONL file. This cannot establish execution, host identity, independent review or cross-session learning.

## Decision

Without an explicit runtime, the CLI prints only a non-executed dry-run plan or returns `COLLECTIVE_RUNTIME_UNAVAILABLE` with exit 2 before side effects. The public CLI has no runtime dependency on the private experimental package. Preview helpers reject operational changes, completion, experience generation and persistence, including direct calls. Their read paths return independent plan copies and never authorize completion. Historical records are preserved without retroactive approval or reclassification.

## Alternatives considered

**Adding permissions and persistence to the preview board** creates another task authority without native session provenance, revision checking or durable review. Native TeamService already owns these responsibilities.

**Keeping simulation behind the run command with a warning** still produces approvals that callers may mistake for evidence. The retained dry-run emits only proposed tasks, no simulated results.

## Consequences

The preview does not execute missions; the separate [explicit runtime bridge](../feature/2026-09-12-explicit-collective-runtime-bridge.md) delegates an operator-selected laboratory. Native TeamService remains intact. Existing reports can be inspected only as unverified data; memory approval remains with its existing owner. Source-entry subprocess tests and direct prototype tests verify denial and preservation without inference. Built-entry snapshots require rebuilt CLI artifacts; no test here proves model performance or general collective competence.
