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
   - `nomic-embed-text:latest` through a loopback embedding endpoint; `api` selects the Ollama `/api/embed` or OpenAI-compatible `/v1/embeddings` dialect.
   - Workspace filtering occurs before any candidate text reaches Ollama.
   - A bounded in-process document-vector cache and hybrid reranking add same-meaning recall without changing the durable schema.
   - Timeout, transport, validation, and response-size failures fall back to lexical retrieval.
4. **Deterministic final ranking (always on in the Leon preset)**
   - Validate exact workspace ownership, provider output, temporal lineage, and active validity; remove duplicate ids and cap the model-facing result.
   - Weight normalized provider relevance at 55%, exponential recency at 20% with a 30-day half-life, importance at 15%, and confirmation plus confidence at 10%.
   - Treat legacy records as neutral and resolve ties by score, update time, then id.
5. **Business filters**
   - `workspaceId`, temporal validity, supersession, expiry, and `sensitivity`.
6. **Audit history (explicit only)**
   - `includeHistory`/`include_history` retains validated inactive revisions and deduplicates by id plus revision.
   - Audit retrieval is lexical and never feeds automatic recall or the semantic index.

## Recommended pipeline

1. Build the query from the user's message.
2. Apply the mandatory workspace filter.
3. Run literal and lexical search every time.
4. Optionally run local semantic search when enabled, locally available, and above the configured minimum score.
5. Validate temporal lineage, merge, and deduplicate active results by `id`.
6. Apply the shared final score to explicit search and automatic recall.
7. Limit results according to policy, item count, and character budget.
8. Expose the retrieval reason in `MemoryContextComposer`; use explicit history only for an audit request.

## Context control

- Use a bounded context string, such as 1,000–3,000 tokens in the initial flow.
- Exclude invalid memories: expired, superseded, or `status != active`.
- When a correction is scheduled, keep the prior revision active until the new `validFrom` instant.
- Never transform memory into instructions; present it as a non-privileged context section.

## Derived similarity graph

- The local provider can derive pairwise cosine edges between active memory revisions through the same bounded embedding index (`linking.enabled`).
- One committed create, correction, or forget marks the workspace dirty; a debounced service-side rebuild embeds the active records once and publishes the whole edge set atomically. Reads never trigger computation.
- Snapshots store the input revision map; a later commit invalidates an in-flight computation through the generation counter, and changed, corrected, forgotten, or expired records remove their edges.
- Snapshot status distinguishes `pending` (never computed), `computed`, `empty` (no edge above `minScore`), `stale` (inputs changed), and `failed` (no automatic retry until the next commit); a provider without the index reports `unavailable`.
- Edges are derived similarity, not factual relations; the personal-memory adapter computes an independent graph per owner partition and never links across owners or workspaces.
- `linking.minScore` sets the edge threshold, `maxEdgesPerNode` and `maxGraphNodes` bound the snapshot, `maxExpandedHits` bounds edge-neighbors appended inside a search's remaining limit, and `debounceMs` coalesces commit bursts.
- The content-free `memory/graph` event (`MemoryGraphEvent`) reports status, node and edge counts, embedding cost, and sanitized failure classes.

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
- Temporal-history rollback is independent: set `memory-local.historyMode: v1` for new in-place corrections; existing V2 values remain readable.
