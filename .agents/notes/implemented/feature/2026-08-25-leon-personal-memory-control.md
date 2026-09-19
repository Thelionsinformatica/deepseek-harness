# Agent Note: Leon personal-memory user control

Status: implemented

English | [中文](2026-08-25-leon-personal-memory-control.zh.md)

## Problem

Leon had a durable personal-memory service and model tools, but the user could not independently inspect what was stored, correct a stale preference, permanently remove it, or stop automatic personal recall from the browser. Reusing workspace administration would have hidden the distinct ownership boundary and risked presenting personal facts as project data.

## Decision

The existing Host-owned `memoryCandidateReview` Remote now exposes a separate set of personal-memory administration operations when a deployment configures `personalOwnerId` and composes both `personalMemory` and `settings`. The browser never receives or chooses the owner id. A Session authorizes the local request and supplies provenance, but its workspace does not derive or change personal ownership.

The `personal-memory` settings namespace stores a live `enabled` preference. Disabling it blocks personal recall, creation, and correction before provider execution. Listing and permanent forgetting remain available so a user can inspect or delete existing records even while recall is off. Re-enabling applies immediately to the shared runtime and survives restart through the existing settings provider.

The Web UI adds a third `Pessoal` tab beside suggestions and workspace memories. It supports bounded listing and search, explicit addition, exact-revision correction, permanent forgetting, and the enablement control. Every mutation has a visible confirmation. Credential-like content is rejected at both the Host administration edge and provider-neutral personal-memory edge.

Personal administration writes content-free intent and outcome rows to `personal_memory_admin`, a domain separate from workspace `memory_admin` and from the personal records themselves. Audit rows contain the configured owner label, Session, operation, ids, revisions, requested enablement, timestamps, status, and stable failure codes, but never memory text.

## Verification

Runtime tests prove disabled recall and writes fail while listing and forgetting remain possible. Host integration tests prove cross-owner isolation, explicit confirmation, add/correct/forget behavior, settings persistence, immediate enablement changes, and content-free audit rows. Browser tests cover Remote result unwrapping and the complete Portuguese panel flow, including confirmation, retry, disabling, correction, and deletion. Host and Client TypeScript aggregates compile after regenerated Typert contracts.

## Alternatives considered

- **Reuse workspace memory administration** — rejected because a Session workspace is only an authorization anchor; it is not the owner of personal facts.
- **Hide records whenever memory is disabled** — rejected because a privacy control must not prevent inspection or deletion of existing data.
- **Let the browser send an owner id** — rejected because that would turn presentation state into an authorization decision.
- **Store the enablement flag in component state** — rejected because it would be lost on restart and would not govern model tools or automatic recall.

## Consequences

Leon now gives the user direct control over personal continuity across projects without weakening workspace isolation. The feature remains local, keyless, provider-independent, confirmation-gated, and removable from a composition by omitting `personalOwnerId`.

The single-owner label is deployment configuration, not authenticated multi-user identity. Encryption at rest, export/backup controls, and organization-wide memory remain separate future work.
