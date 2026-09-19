# Memory V2 rollback

English | [中文](leon-memory-v2-rollback.zh.md)

## Objective

Reverse increments with low risk while preserving existing memory.

## General strategy

- Remove the automatic write pipeline first.
- Remove new extraction and observability second.
- Keep the current core, including providers and explicit tools, intact.

## Rollback levels

### Level 1 — Configuration

- Set `autoRecallMode=off`.
- Set `automaticRecall=false`.
- Set `memory-local.semanticSearch.enabled: false`. Lexical search remains available, the in-process vector cache is discarded on restart, and no durable schema rollback is required.
- Set `tool-memory.ranking.enabled: false` to use validated provider-score order while preserving workspace filtering, deduplication, sensitive filtering, and context limits.
- Set the `memory-candidate-review` Host config `automaticWrite: false` and empty both exact allowlists.
- Retain optional manual recall when it already exists.

### Level 2 — Disable per workspace or user

- Disable controlled writes without deleting review evidence:
  - `automaticWrite: false`
  - `automaticWriteWorkspaceIds: []`
  - `automaticWriteUserIds: []`
- Retain the explicit fallback through `memory_remember`, `memory_search`, `memory_update`, and `memory_forget`.

### Level 3 — Operational isolation

- Retain `ctx.memory` and `memory-local`.
- Unregister policy, queue, and extractor services.
- Exclude new events from the query pipeline.

### Level 4 — Extreme recovery

- Restore a baseline branch or tag such as `leon-memory-v1-baseline`.
- Preserve local tables without transformation.
- Run the baseline suite and restart validation again.

## Safe backout

- Do not remove old memory records during the initial rollback.
- Do not delete the journal without an authorized export or import.
- Do not change public interfaces without updating the preset and documentation.
- A candidate left at `autoWrite.status = writing` is an uncertain prior write. Do not retry it automatically; reconcile its local memory and journal records first.
