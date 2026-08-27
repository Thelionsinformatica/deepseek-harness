# Agent Note: Provider-neutral controlled Memory V2

Status: proposed

English | [中文](2026-08-22-provider-neutral-controlled-memory-v2.zh.md)

## Problem

Leon has durable local memory and read-only automatic recall, but it lacks one structured, auditable path for automatic extraction, deterministic write decisions, decision history, and measured benefit before expansion to external providers.

## Proposal

Deliver Memory V2 in phases: observability and shadow mode first, deterministic write policy second, and optional semantic retrieval after local evidence supports it.

## Decision architecture

- Keep `ctx.memory` as the provider-neutral seam.
- Add `MemoryPolicyService`, `MemoryCandidateExtractor`, and `MemoryCandidateJournal` roles.
- Introduce a versioned `MemoryDecisionEvent` for shadowed, rejected, confirmed, and stored outcomes.
- Extend retrieval into a hybrid pipeline with token bounds and validity filters.
- Keep automatic writes disabled without an explicit feature flag and policy validation.

## Consequences

- The memory module remains independent of the selected model and provider.
- Retrieval can improve continuity without granting stored content system authority.
- A durable decision trail makes review and rollback operational.
- Letta adoption remains a later experimental step.
- The first [direct-provider experiment](../../rejected/architecture/2026-08-25-direct-letta-memory-provider.md) did not meet the compatibility gate; reconsideration now has explicit safety, recall, latency, and cost thresholds.

## Alternatives considered

**Enable automatic writes before shadow evidence.** Rejected because false-positive retention would precede the review, rollback, and policy signals needed to operate it safely.

**Make Letta the core memory implementation.** Deferred because the local provider-neutral seam must remain the stable owner; Letta may later join as an experimental provider after the local decision path is measurable.

## Acceptance criteria

- No operation reads or writes across workspace ownership.
- No semantic memory write occurs without the configured authorization and policy decision.
- Sensitive recalled data never gains instruction authority.
- Escalation to non-local services requires explicit consent.

## Risks

- Extraction and retrieval policies can retain irrelevant facts or miss useful ones.
- A policy-version change can make historical decisions incomparable unless events preserve their version.
- Hybrid retrieval can add token and latency costs that exceed its measured benefit.
- Shadow candidates can accumulate faster than operators review them, so retention and review bounds remain necessary.
