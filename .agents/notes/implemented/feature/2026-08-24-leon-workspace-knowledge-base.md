# Agent Note: Leon workspace knowledge base

Status: implemented

English | [中文](2026-08-24-leon-workspace-knowledge-base.zh.md)

## Problem

Leon needs durable document knowledge that survives model changes and session compaction without turning personal memory into a document dump. A useful answer must remain traceable to the bytes that entered the project, while generated summaries and relationships must be repairable when the source changes or two sources disagree.

Giving every document body to `memory_remember` loses this distinction and makes provenance, contradiction handling, and integrity checks implicit. Installing a vector database before observing retrieval failures would add another service and migration surface without proving that semantic search is needed.

## Decision

The shipped Leon preset includes the on-demand `leon-knowledge-base` Skill. It creates one explicit base per workspace under `.leon/knowledge/` and keeps it separate from personal `memory_*` records:

- `raw/` holds immutable, content-addressed source copies.
- `wiki/` holds generated source, concept, entity, comparison, and synthesis pages.
- `index.md` is the first lookup surface.
- `schema.yml` records the format and write rules.
- `log.md` is append-only operational history.

The Skill's deterministic `scripts/knowledge.mjs` helper owns initialization, ingestion, status, and lint. Ingestion accepts only regular files inside the active workspace, rejects its own generated tree, rejects likely credential files, limits a source to 25 MB, copies the bytes under their full SHA-256, and creates a pending source page. Repeating the same content is idempotent. Lint recomputes source hashes, checks required metadata, index and log membership, and validates wiki links.

The model owns synthesis under the Skill instructions. It treats source content as untrusted data, never edits `raw/`, grounds durable wiki claims in source pages, records disagreements instead of silently choosing one, and checks important claims against the raw source when answering. PDF and other binary files can be preserved, but synthesis requires a compatible reader or an extracted textual source.

The capability is a scoped Skill instead of a new storage provider. The current consumer is the Leon agent workflow and the current provider is the project filesystem; splitting it into service, provider, and consumer packages would create abstractions without a second implementation. A provider seam becomes justified when a second storage backend, non-agent consumer, or measured retrieval scale requires it.

## Verification

Focused helper tests exercise repeatable initialization, immutable hash-based ingestion, duplicate handling, workspace containment, sensitive-source rejection, status counts, raw-source tamper detection, and broken wiki links. The Leon preset integration test proves the Skill remains scoped to Leon and loads through the real `skill` tool. A loader snapshot pins the exact model-visible catalog entry and complete loaded instructions through the shipped composition.

## Alternatives considered

**Store documents in personal memory** — rejected because it merges preferences and facts about the user with external source material and loses an auditable source-of-truth boundary.

**Install embeddings, a vector database, or Letta immediately** — rejected for V1. The initial workflow can recover through the index and text search, while raw sources and Markdown remain portable. Retrieval evaluations can later show whether semantic search earns its operational cost.

**Ship prose instructions without a deterministic helper** — rejected because path containment, content-addressed copies, size limits, idempotency, and integrity lint must not depend on model compliance.

**Create dedicated storage packages now** — rejected because there is only one provider and one consumer. The repository's service/provider/consumer pattern applies when real replaceability exists, not as speculative structure.

## Consequences

Leon gains portable project knowledge whose evidence survives a switch among local and API models. Loading the Skill adds only its short catalog description until the task needs the complete workflow, and no background watcher or cloud service receives project data.

The V1 deliberately has no automatic folder watcher, PDF extraction pipeline, embeddings, reranker, web interface, or background consolidation. Users or the agent explicitly ingest sources and run lint. This makes provenance and cost predictable, but large or weakly named collections may later require measured retrieval improvements and a promoted provider boundary.
