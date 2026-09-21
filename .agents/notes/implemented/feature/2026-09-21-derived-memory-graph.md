# Agent Note: Derived memory similarity graph

Status: implemented

English | [中文](2026-09-21-derived-memory-graph.zh.md)

## Problem

Durable memories accumulated as an unordered record set: the read-only overview grouped entries by scope and the `supersedes`/`supersededBy` fields carried only temporal lineage. There was no derived structure connecting related memories, no background process maintaining it, and no way for search to reach a relevant memory that shares no tokens with the query.

## Decision

`memory-local` and `personal-memory-local` derive a bounded pairwise cosine graph through the existing `OllamaSemanticIndex`, which gained an `api` dialect field covering Ollama `/api/embed` and OpenAI-compatible `/v1/embeddings` endpoints. `linking.enabled` schedules a debounced service-side rebuild after each committed create, correction, or forget; reads never trigger computation. One atomically published snapshot per workspace or owner partition (`graph` table inside each existing domain, version unchanged) stores the input revision map, generation, algorithm version, model, parameters, and edges pinned to exact revisions. Snapshot status distinguishes `pending`, `computed`, `empty`, `stale`, and `failed`; providers without the index report `unavailable`. A newer commit bumps the generation so an obsolete computation publishes nothing. Search appends edge-neighbors inside a request's remaining limit capacity without displacing direct hits, and only on a `computed` snapshot. Edges are labeled derived similarity, never factual relations; personal and workspace partitions are computed independently and never link across owners or workspaces. Two read-only admin remotes (`memoryGraph`, `personalMemoryGraph`) project the snapshot to the browser without workspace or owner ids, and the overview panel draws published edges inside the existing group diagram.

## Alternatives considered

**An external graph service (Graphiti, Mem0).** Rejected for this version: it adds Python and a graph server plus LLM extraction of entity triples, while the validated local embedding endpoint already supplies the similarity signal. Explicit user-confirmed relations can be layered later without an extraction model.

**Per-edge writes instead of snapshots.** Rejected because a partial write set cannot be invalidated atomically and a stale computation could reintroduce a corrected or forgotten memory.

**Read-triggered (lazy) computation.** Rejected because opening the inspection panel must stay a pure read and would re-embed on every query.

## Consequences

Graph state is derived and rebuildable from authoritative records; deleting the `graph` table loses no memory content. Embedding work runs on a dedicated local endpoint so it does not contend with the conversation model loader. A provider crash records one `failed` snapshot and waits for the next commit rather than retrying per read. Deployments choose `linking.minScore` per embedding model; the Leon web profile uses 0.75 from a measured pt-BR gap (related pairs 0.805-0.891, unrelated 0.646-0.692).

## Verification

Unit tests cover OpenAI-compatible response ordering and rejection classes, canonical edge ordering, threshold and per-node bounds, and the revision-keyed cache. Scheduler tests cover atomic publication, generation-based discard of obsolete computations, correction/forget edge removal, workspace isolation at seeding, failure recording without read-triggered retries, and disposal before debounce. Provider-composition tests cover the pending/computed/stale lifecycle, restart persistence on the same medium, admin-remote projections without scope ids, owner-partition isolation, and search expansion surfacing an edge-neighbor the lexical query missed while the embedding endpoint is down. These checks do not measure recall quality on a real corpus; LEON-EVAL-PTBR owns that evidence.
