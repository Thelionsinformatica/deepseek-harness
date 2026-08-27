# Agent Note: Provider-neutral workspace memory with a local first provider

Status: implemented

English | [中文](2026-08-22-provider-neutral-workspace-memory.zh.md)

## Problem

Leon needs durable memory that survives sessions and context compaction, but making Letta, one vector database, or raw conversation logs the product's source of truth would bind identity and continuity to an external implementation. Memory also creates an authority boundary: a fact retained for one project must not appear in another workspace, and stale model context must not overwrite a newer correction.

## Decision

- **Leon owns a provider-neutral memory capability seam.** `@deepseek-ai/dsh-memory` publishes `ctx.memory`, normalized request and record types, execution-time provider selection, bounds, and structured errors. Providers register capabilities rather than tools. Letta can later implement the same `MemoryProvider` contract without changing the model-facing API or becoming the owner of Leon's identity.
- **Workspace identity is the first and only shipped scope.** Every operation carries a stable `WorkspaceId`; raw paths are resolved by `ctx.workspaceRegistry` at execution time and never become durable ownership keys. Search filters by workspace before ranking, and cross-workspace mutation returns the same miss as an unknown id so existence does not leak.
- **The local provider is the first durable implementation.** `@deepseek-ai/dsh-memory-local` owns the versioned `memory_local` storage domain and uses the already selected `ctx.storageDomain` backend. It stores session provenance, ISO timestamps, and monotonically increasing revisions. Mutations are serialized, and the storage-domain durability boundary lands before the operation resolves.
- **Corrections and deletion use compare-and-set references.** Search returns `{ id, revision }`; update and forget require that exact pair. A stale revision fails with `MEMORY_REVISION_CONFLICT` instead of silently replacing newer state.
- **Retention is explicit in the first milestone.** `@deepseek-ai/dsh-tool-memory` contributes `memory_remember`, `memory_search`, `memory_update`, and `memory_forget` only when both memory and workspace services exist. Its policy forbids authentication secrets and permits writes only for explicit remember intent or a clearly confirmed durable fact. It does not automatically copy conversation history into long-term memory.
- **The Web profile selects the local provider, while the Leon preset owns only the Consumer.** The host mounts the seam and local provider with `provider: local`. The preset's optional Consumer activates when those host services exist, so composing Leon in a headless profile without memory does not publish broken tools.

## Verification

The memory seam tests pin provider selection, ambiguity, duplicate ids, input normalization, result caps, and cancellation forwarding. The local provider tests pin create, accent-insensitive search, correction, stale-revision rejection, deletion, durable reopen, failed-write containment, and workspace isolation. A keyless real-agent-loop integration boots storage, workspace, memory, the local provider, and the four tools; a scripted model retains and retrieves a fact and snapshots the resulting tool catalog without any external API key.

## Alternatives considered

- **Make Letta the core memory service** — rejected because its server lifecycle, data model, and release cadence would become Leon's continuity boundary. Letta remains a candidate Service Provider behind the stable contract.
- **Treat the session event log as long-term memory** — rejected because the log is conversation evidence, not a curated fact store; compaction changes model-visible history, and cross-session retrieval has different retention and authority requirements.
- **Key memories by raw workspace path** — rejected because aliases, symlinks, normalization, and directory moves make paths unstable references. The existing workspace registry already supplies durable ids.
- **Automatically retain every conversation turn** — rejected because it creates uncontrolled privacy, quality, and deletion problems. Explicit selective retention is the safe first policy; automatic extraction requires a later evaluated authority and redaction design.
- **Install embeddings and a vector database immediately** — rejected because the initial local corpus is small and lexical retrieval is keyless, deterministic, and testable. Retrieval quality evaluation should justify the added operational stack before it becomes a dependency.

## Consequences

Leon now has durable project memory that is independent of any model and can survive provider replacement. The local path adds no API key, service process, Docker dependency, or external data transfer, and workspace isolation plus revisions fail closed against the two highest-risk corruption paths. The first provider deliberately remains lexical. A follow-up decision adds bounded, read-only automatic recall without changing this ownership contract; see [controlled automatic recall](2026-08-22-controlled-automatic-memory-recall.md). Global memory, embeddings, imported Letta provenance, schema migration tooling, and a Letta provider remain later work.
