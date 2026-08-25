# Agent Note: Workspace memory administration

Status: implemented

English | [中文](2026-08-25-workspace-memory-administration.zh.md)

## Problem

Leon could recall, correct, and forget durable facts through model-facing tools, while shadow candidates already had a human review queue. Operators still lacked a direct way to inspect saved facts, filter temporal history, correct an exact revision, or forget a lineage without asking the model to act.

## Decision

- Add a provider-neutral `list()` operation to `ctx.memory` for bounded administrative pages filtered by workspace, optional text, and lifecycle status.
- Keep the public model tool surface unchanged. Saved-memory administration is a browser-to-Host Remote and never enters model context.
- Resolve every request from a Session id to exactly one registered workspace. The browser cannot supply a workspace id or raw path.
- Require a visible two-stage confirmation plus exact id and revision before correction or forgetting. The Host independently enforces `administrationMode: full`; `read-only` is the rollback mode.
- Write a content-free audit row before each attempted mutation and finalize it with a machine outcome. Audit rows contain the Session, workspace, operation, memory id, revision, and result, but not memory content.
- Redact credential-like legacy rows before browser projection. Corrections with credential-like content are rejected before persistence.

## Verification

Provider tests cover lifecycle filtering, pagination, history, and workspace isolation. Host integration tests cover list, correction, forgetting, confirmation, read-only rollback, credential redaction, and audit outcomes. Browser tests cover saved-memory listing, the all-status filter, visible confirmation, correction, forgetting, and error paths. The generated Host contract and aggregate client typecheck prove the Remote remains browser-safe.

## Alternatives considered

- **Expose administrative list as a fifth model tool** — rejected because the operator UI does not need to increase prompt schema cost or grant the model broader inspection authority.
- **Reuse search with an empty query** — rejected because search is relevance-oriented, active-first, and model-facing, while administration needs deterministic pagination and explicit lifecycle filtering.
- **Audit after mutation only** — rejected because a crash could leave an unaudited state change. Admission is recorded before the provider call and finalized afterward.

## Consequences

Users can now inspect and govern Leon's saved workspace facts directly while preserving temporal history, revision safety, and workspace isolation. The feature does not create global memory, edit automatic-write allowlists, or place administrative data in prompts. Disabling mutations requires only switching `administrationMode` to `read-only`.
