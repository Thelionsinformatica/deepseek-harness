# Agent Note: Bounded memory graph recovery

Status: implemented

English | [中文](2026-09-25-bounded-memory-graph-recovery.zh.md)

## Problem

A temporary local embedding outage could leave a memory graph failed until another commit or restart. A batch or document exceeding an endpoint's physical limit failed the entire partition and replaced its previous coverage with an empty failure. Increasing the service's context is insufficient because document length and aggregate batch size are distinct constraints.

## Decision

`MemoryGraphScheduler` retries only transient transport, timeout, and selected HTTP failures, with a finite per-generation attempt budget and capped exponential delay. Startup seeds failed persisted partitions. New commits cancel obsolete work; disabling and disposal cancel retries and inference before the domain closes. Reads never trigger retries or reset their budget. This replaces the original fail-until-commit behavior in the [derived graph decision](../feature/2026-09-21-derived-memory-graph.md) while retaining its atomic publication and read-only boundaries.

Graph algorithm version 2 splits complete text into bounded Unicode-safe chunks and bounded batches. Explicit input overflow splits batches before recursively splitting singleton chunks. A depth limit and whole-pass deadline bound adaptation. Length-weighted means incorporate every chunk; no fact or revision is edited or truncated. Retrieval and graph vector cache purposes are separated within one bounded LRU, so invocation order does not change the graph algorithm.

Failed rebuilds retain the previous snapshot's exact revision coverage and provenance with an explicit failed status. Incomplete embedding passes are not published as current coverage. Workspace and personal providers share these rules; no new public snapshot fields are required. Configuration defaults are documented in the provider READMEs.

## Alternatives considered

**Unlimited or read-triggered retries.** These make a read create inference work and can loop while the endpoint remains unavailable. A bounded generation budget makes the cost predictable.

**Truncate facts or silently skip rejected documents.** Both hide lost coverage. Complete segmentation preserves the source; exhausted bounds stay explicit failures rather than false successful partitions.

**Only enlarge the embedding server's context.** This does not distinguish singleton input limits from aggregate batch limits and couples memory correctness to one deployment's physical budget.

**Reuse whole-document cache entries for chunk means.** This makes graph output depend on whether retrieval ran first. Purpose-specific entries preserve algorithm identity without growing the total cache budget.

## Consequences

Short outages can recover without a new user write, including after a cold start. Retry exhaustion is intentionally terminal until a new generation, re-enablement, or restart. Long documents incur extra requests; adaptive subdivisions and retries remain bounded. Stored facts remain complete and independently readable even when graph computation fails.

Chunk averaging is approximate and may shift similarity scores; long-document recall and thresholds still need model-specific calibration. The relation remains similarity, not verification, causality, or authority to edit a fact. This change does not alter the local embedding server's 2,048-token deployment budget or query-time lexical fallback.

Focused tests cover finite attempts, cancellation, disposal, cold-start recovery through a real Loader and JSON backend, full input coverage, explicit exhaustion, and numeric weighting. The runnable `examples/headless-agent/memory-graph-recovery.cordis.yml` composition exercises a synthetic loopback endpoint and temporary storage; no cloud or production memory is involved.
