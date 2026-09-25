# @deepseek-ai/dsh-memory-local

English | [中文](README.zh.md)

This package is the local Service Provider for `ctx.memory`. It opens the versioned `memory_local` domain through `ctx.storageDomain`, so the deployment-selected storage backend owns the physical medium and durability behavior.

## Behavior

Changing a record's content clears omitted confirmation and confidence fields; the old approval does not certify the new text. An unchanged-content update preserves omitted fields. A Host update may explicitly supply fresh `validation` and `confidence` after its own confirmation checks. This applies in both `v1` and `temporal-v2` modes; in temporal mode, the prior revision retains its original metadata in history. This is revision invalidation and metadata persistence, not factual verification of the replacement or a retroactive audit of stored memories.

- Records are keyed by generated `MemoryId` values and carry stable `WorkspaceId` ownership, session provenance, ISO timestamps, a compare-and-set revision, and any optional importance, confidence, confirmation, and temporal metadata supplied at creation.
- Create, correct, and forget operations are serialized. In the default `temporal-v2` mode, one correction atomically writes the new current revision and the immutable prior revision inside the same lineage value. The durable write lands before the operation resolves.
- Active search filters by workspace and evaluation time before ranking or sending candidate text to another local component. Scheduled, expired, and replaced revisions remain absent by default. `includeHistory: true` returns valid audit revisions through deterministic lexical search; history text is not sent to the semantic index.
- A future correction keeps the prior revision active until the new revision's `validFrom`; an immediate correction closes the prior revision at the transition instant.
- Optional hybrid retrieval uses the loopback Ollama `/api/embed` endpoint with `nomic-embed-text:latest`. Queries and documents use the model's `search_query:` and `search_document:` task prefixes, then semantic and lexical scores are merged under bounded configuration.
- Semantic document vectors live only in a bounded in-process LRU cache. They are invalidated after correction or forgetting and rebuilt lazily after restart; the durable memory schema does not change.
- Any local timeout, transport error, invalid response, or oversized response falls back to lexical results. The `memory/semantic-search` event reports mode, counts, duration, model, and a sanitized failure code without query or memory content.
- Cross-workspace correction and deletion return the same `MEMORY_NOT_FOUND` error as an unknown id, so record existence does not leak between workspaces.

## Configuration

`historyMode` defaults to `temporal-v2`. Set it to `v1` only as an emergency rollback: new corrections resume in-place overwrite behavior and do not add history. Existing V2 records remain readable, and active-search validity and expiry filters remain enforced.

`semanticSearch.enabled` defaults to `false`. When enabled, `baseUrl` accepts only an unauthenticated HTTP origin on `127.0.0.1` or `::1`, and redirects are rejected. `api` selects Ollama `/api/embed` or `openai-compatible` `/v1/embeddings`. The model must already be available at that endpoint; the provider never downloads one. A deployment must independently ensure its loopback endpoint does not proxy memory text to a remote service.

The shipped Leon Web composition keeps the feature disabled until local recall and latency are accepted. Its baseline uses 256 dimensions, at most 200 workspace-filtered candidates, and at most 2,000 cached document vectors.

### Derived similarity graph

`linking.enabled` requires semantic search and remains opt-in. Committed writes, startup, and validity/expiry deadlines schedule bounded background rebuilds; reads do not. Persistence is awaited before success is announced, and disposal drains submitted work before closing the domain. Empty partitions are rebuilt after restart. Future corrections retain the currently active historical revision until their effective date. History searches do not expand through the current graph.

Graph limits and embedding bounds are validated before storage opens. OpenAI-compatible response indices must map each input exactly once. Oversized inputs produce the sanitized `INPUT_TOO_LARGE` failure without truncation; the endpoint's context and physical batch must both fit each document. Failures remain explicit instead of being represented as an empty graph. A committed stale write cannot be undone during backend I/O, but is not announced or exposed as a current result and is rebuilt.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-memory`; this provider registers no tool or prompt section.

#### KV Cache effect

None. Semantic retrieval changes neither prompts nor model messages; only the selected memory records can later affect the bounded memory context assembled by `@deepseek-ai/dsh-tool-memory`.

## Known Limitations and Deferred Work

- The semantic cache is a bounded linear reranker, not a persistent vector database or approximate-nearest-neighbor index. Cold model load is visibly slower than warmed retrieval, and large workspaces remain bounded by `maxCandidates`.
- Local measurements are hardware-dependent. On the Leon development machine, one eight-input, 256-dimension batch took about 7.7 seconds with a cold model and 68.5–107.4 ms across four immediately warmed runs. These numbers are an operational baseline, not a portable performance guarantee.
- Schema V2 fields and nested history are optional, so legacy V1 values remain readable without a physical migration. The domain still has no general migration runner; a future incompatible schema change must ship an explicit migration path.
