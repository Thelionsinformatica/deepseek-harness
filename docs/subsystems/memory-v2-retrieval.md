# Memory V2 — Search and retrieval

English | [中文](memory-v2-retrieval.zh.md)

## Goal

Deliver robust, auditable, local-first retrieval, beginning with the existing lexical search and evolving toward local hybrid retrieval.

## Retrieval layers

1. **Exact match**
   - Deterministic matching for exact tokens.
2. **Lexical search (always on)**
   - `memory-local` normalizes and scores terms and remains the deterministic fallback.
3. **Local semantic search (implemented, opt-in)**
   - `nomic-embed-text:latest` through the loopback Ollama embedding endpoint.
   - Workspace filtering occurs before any candidate text reaches Ollama.
   - A bounded in-process document-vector cache and hybrid reranking add same-meaning recall without changing the durable schema.
   - Timeout, transport, validation, and response-size failures fall back to lexical retrieval.
4. **Deterministic final ranking (always on in the Leon preset)**
   - Validate exact workspace ownership and provider output, remove duplicate ids, and cap the model-facing result.
   - Weight normalized provider relevance at 55%, exponential recency at 20% with a 30-day half-life, importance at 15%, and confirmation plus confidence at 10%.
   - Treat legacy records as neutral and resolve ties by score, update time, then id.
5. **Business filters**
   - `workspaceId`, `userId`, `status`, temporal validity, and `sensitivity`.

## Recommended pipeline

1. Build the query from the user's message.
2. Apply the mandatory workspace filter.
3. Run literal and lexical search every time.
4. Optionally run local semantic search when enabled, locally available, and above the configured minimum score.
5. Validate, merge, and deduplicate by `id`.
6. Apply the shared final score to explicit search and automatic recall.
7. Limit results according to policy, item count, and character budget.
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
- Cold-start and warmed batch latency, cache-hit count, embedded-document count, and lexical-fallback rate from the content-free `memory/semantic-search` event.

## Search migration

- Phase 1: keep lexical search as the default and do not block rollout without demonstrated benefit.
- Phase 2: implemented behind `semanticSearch.enabled: false`; enable only when LEON-EVAL-PTBR demonstrates that recall gains exceed cold-start, latency, and local resource cost.

## Current operational baseline

- Default semantic dimensions: 256.
- Maximum candidates per workspace-filtered query: 200.
- Maximum cached document vectors: 2,000.
- Measured on the Leon development machine with eight inputs: about 7.7 seconds after a cold model load, then 68.5–107.4 ms across four warmed runs.
- Rollback is immediate: set `semanticSearch.enabled: false`; lexical retrieval continues and no memory migration is required.
- Final-ranking rollback is independent: set `tool-memory.ranking.enabled: false` to preserve validated provider-score order without disabling retrieval or deleting metadata.
