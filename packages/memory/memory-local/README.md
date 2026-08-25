# @deepseek-ai/dsh-memory-local

English | [中文](README.zh.md)

This package is the local Service Provider for `ctx.memory`. It opens the versioned `memory_local` domain through `ctx.storageDomain`, so the deployment-selected storage backend owns the physical medium and durability behavior.

## Behavior

- Records are keyed by generated `MemoryId` values and carry stable `WorkspaceId` ownership, session provenance, ISO timestamps, a compare-and-set revision, and any optional importance, confidence, and confirmation metadata supplied at creation.
- Create, correct, and forget operations are serialized. The durable write lands before the operation resolves.
- Search always filters by workspace before ranking or sending candidate text to another local component. Deterministic, accent-insensitive lexical matching remains available on every request.
- Optional hybrid retrieval uses the loopback Ollama `/api/embed` endpoint with `nomic-embed-text:latest`. Queries and documents use the model's `search_query:` and `search_document:` task prefixes, then semantic and lexical scores are merged under bounded configuration.
- Semantic document vectors live only in a bounded in-process LRU cache. They are invalidated after correction or forgetting and rebuilt lazily after restart; the durable memory schema does not change.
- Any local timeout, transport error, invalid response, or oversized response falls back to lexical results. The `memory/semantic-search` event reports mode, counts, duration, model, and a sanitized failure code without query or memory content.
- Cross-workspace correction and deletion return the same `MEMORY_NOT_FOUND` error as an unknown id, so record existence does not leak between workspaces.

## Configuration

`semanticSearch.enabled` defaults to `false`. When enabled, `baseUrl` accepts only an unauthenticated HTTP origin on `127.0.0.1` or `::1`; the provider will not send memory text to a remote embedding endpoint. The model must already be installed in Ollama—the provider never downloads one automatically.

The shipped Leon Web composition keeps the feature disabled until local recall and latency are accepted. Its baseline uses 256 dimensions, at most 200 workspace-filtered candidates, and at most 2,000 cached document vectors.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-memory`; this provider registers no tool or prompt section.

#### KV Cache effect

None. Semantic retrieval changes neither prompts nor model messages; only the selected memory records can later affect the bounded memory context assembled by `@deepseek-ai/dsh-tool-memory`.

## Known Limitations and Deferred Work

- The semantic cache is a bounded linear reranker, not a persistent vector database or approximate-nearest-neighbor index. Cold model load is visibly slower than warmed retrieval, and large workspaces remain bounded by `maxCandidates`.
- Local measurements are hardware-dependent. On the Leon development machine, one eight-input, 256-dimension batch took about 7.7 seconds with a cold model and 68.5–107.4 ms across four immediately warmed runs. These numbers are an operational baseline, not a portable performance guarantee.
- The domain is schema-versioned but has no migration runner yet; a future schema change must ship an explicit migration path.
