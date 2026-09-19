# Agent Note: Direct Letta memory provider

Status: rejected — the current Letta Agent SDK is another stateful agent harness, not a drop-in revisioned memory provider, and the legacy V1 bridge cannot meet Leon's current contract or measured-improvement gate

English | [中文](2026-08-25-direct-letta-memory-provider.zh.md)

## Problem

Leon needs richer long-term recall, but its memory source of truth must preserve workspace ownership, exact revision conflicts, temporal history, deterministic forgetting, bounded administration, and local-first operation. An external memory system is useful only if it improves retrieval without weakening those guarantees.

## Proposal

Implement `LettaMemoryProvider` behind `ctx.memory`, compare it with `LocalMemoryProvider`, and migrate only if it passes the safety contract and an objective quality and latency threshold.

## Evaluation

The local provider passed all 31 LEON-EVAL-PTBR scenarios in three stable runs and all 139 memory-scope tests. The official Letta project has retired the V1 server targeted by the pinned community MCP bridge. Its maintained Agent SDK runs local, cloud, or remote stateful agents and exposes a different agent, conversation, repository, and git-backed memory model.

No compatible Letta runtime or endpoint is installed in the evaluated Windows deployment. More importantly, the maintained SDK does not expose Leon's exact provider operations or compare-and-set and temporal-history guarantees. Installing another harness would therefore measure another product's startup and agent loop, not parity with `MemoryProvider`.

## Alternatives considered

**Make Letta the new source of truth.** Rejected because Leon's continuity would depend on a second runtime, release cadence, schema, model configuration, and data location while losing the already-tested provider guarantees.

**Keep the old V1 MCP bridge as an optional tool.** Retained only as a clearly labelled legacy interoperability example for an existing V1 0.16.x deployment. It remains off by default and is not a `MemoryProvider`.

**Use current Letta Agent as a future specialist subagent.** Deferred as a separate experiment. Agent delegation may be valuable, but it must not silently own or rewrite Leon's durable memory.

## Acceptance criteria

A reconsidered adapter must pass every critical LEON-EVAL case, improve paraphrase recall by at least 10 percentage points, keep retrieval p95 at or below 2,000 ms, preserve revision and history semantics, add no unapproved cloud or model cost, and remain optional with the local provider as rollback.

## Risks

Rejecting the direct provider gives up Letta's autonomous memory reorganization inside Leon for now. The decision can become stale as the Agent SDK evolves, so the official API and local deployment path must be rechecked before a future experiment rather than relying on the retired V1 API.
