# Memory V2 — Search and retrieval

English | [中文](memory-v2-retrieval.zh.md)

## Goal

Deliver robust, auditable, local-first retrieval, beginning with the existing lexical search and evolving toward local hybrid retrieval.

## Retrieval layers

1. **Exact match**
   - Deterministic matching for exact tokens.
2. **Lexical search (current)**
   - The current `memory-local` implementation normalizes and scores terms.
3. **Local semantic search (future stage)**
   - `nomic-embed-text` as an optional provider.
   - Semantic reranking with workspace, validity, and status filters.
4. **Business filters**
   - `workspaceId`, `userId`, `status`, temporal validity, and `sensitivity`.

## Recommended pipeline

1. Build the query from the user's message.
2. Apply the mandatory workspace filter.
3. Run literal and lexical search every time.
4. Optionally run local semantic search when it is available and produces a useful score.
5. Merge and deduplicate by `id`.
6. Prioritize by `importance`, recency, and reliability.
7. Limit results according to policy and token budget.
8. Expose the retrieval reason in `MemoryContextComposer`.

## Context control

- Use a bounded context string, such as 1,000–3,000 tokens in the initial flow.
- Exclude invalid memories: expired, superseded, or `status != active`.
- Never transform memory into instructions; present it as a non-privileged context section.

## Minimum metrics

- Query hit rate.
- Useful recall rate: a result used in the next turn.
- Recall@k and manual precision by category.
- Query p95 latency in milliseconds.
- Sensitive-data false-positive rate.
- Token reduction per session after composition.

## Search migration

- Phase 1: keep lexical search as the default and do not block rollout without demonstrated benefit.
- Phase 2: add semantic search only when recall or precision gains exceed its latency and operational cost.
