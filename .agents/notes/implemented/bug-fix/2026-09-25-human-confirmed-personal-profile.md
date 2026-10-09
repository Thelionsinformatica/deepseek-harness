# Agent Note: Human-confirmed personal memory and profile selection

Status: implemented

English | [中文](2026-09-25-human-confirmed-personal-profile.zh.md)

## Problem

The personal remember tool assigned explicit validation and confidence 1 from a model decision. Its core argument also let that decision enter the query-independent profile. The personal panel could neither choose core membership nor reconfirm unchanged text, despite an existing confirmed Host correction operation.

## Decision

Model remember writes a pending record without validation, confidence, or core selection. Model correction cannot select core membership; content changes invalidate prior confirmation. Explicit search labels pending results with `confirmationRequired`, while automatic query and core projections require confirmation. Pending records remain inspectable in the same owner-isolated store without introducing another queue or migrating existing data.

The Host correction request adds optional `core`; omission preserves selection. The browser exposes reconfirmation and explicit include/remove actions, shows the full text for confirmation, and submits the exact revision. Full administration, enabled personal memory, owning Session, sensitive-content rejection, and audit admission remain required. Successful operations append revisions and a content-free audit with optional `desiredCore`; stale revisions fail. These actions are not model tools and add no natural-language consent parser.

The [core-profile lifecycle](../feature/2026-09-22-always-present-core-profile.md) still owns projection budgets, replacement, invalidation, and replay. This decision changes approval authority, not that lifecycle.

## Alternatives considered

**Trust the tool prompt to recognize consent.** Rejected because a model interpretation cannot prove approval of an exact retained revision or profile selection.

**Copy proposals into a second candidate store.** Rejected because existing unconfirmed records already support inspection, correction, exact revisions, and preserved history. A second store would require a new promotion and identity mechanism.

**Automatically downgrade existing confirmed records.** Rejected because this would modify user data without record-specific review and cannot recover independent historical consent evidence.

## Consequences

Automatic recall cannot use a newly proposed fact until human confirmation. This adds a deliberate review step and may reduce recall until pending facts are reviewed. Existing confirmation metadata remains eligible; it is not proof of historical human consent and requires separate user-directed review. Confirming or changing profile selection creates another revision even when text is unchanged. Removing a fact from the profile does not forget it or prevent relevant confirmed query recall.

## Testing

Focused integration, runtime, loader, and browser-component tests cover pending admission, false confirmation, stale revisions, same-text confirmation, profile selection, read-only/disabled/redacted controls, audit choices, and temporal history. The keyless real Loader composition `examples/headless-agent/personal-core-profile.cordis.snapshot.yml` captures the model-visible remember schema, pending tool call, Host confirmation, bounded-profile inclusion/removal, and persisted JSONL replay using synthetic records and scripted model responses. These tests do not call a paid API, alter real memory, or establish live-model quality.
