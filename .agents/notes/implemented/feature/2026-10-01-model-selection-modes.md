# Agent Note: Explicit model selection modes

Status: implemented

English | [中文](2026-10-01-model-selection-modes.zh.md)

## Problem

The composer conflates automatic classification with a deployment that pins the coordinator. A displayed model can therefore differ from the admitted request. Provider names alone also hide models supplied through a different account, and a catalog does not prove quota or execution quality.

## Decision

The existing per-session model directory exposes searchable provider groups and Host-owned metadata. The optional `selectionMode` distinguishes `manual`, `adaptive`, and `team`; the existing `automatic` field remains compatible. Manual uses the exact selected route. Adaptive classifies each admitted prompt using declared tiers independently of the deployment's coordinator default. Team uses the configured coordinator for text and the explicit vision role for image requests.

The Host projects configured coordinator, worker, review, and vision roles as `coordination`. Team selection does not spawn collaborators, require a review for every chat, or combine model answers. Existing delegation and objective completion checks retain that responsibility. Model and mode changes clear pending route decisions that could overwrite the new choice.

Explicit manual selection changes only that session, not the configured global coordinator. Legacy requests without `selectionMode` retain their previous default-saving behavior. An idle Team directory resolves the configured coordinator under the admission lock rather than advertising an obsolete historical route.

The selector displays supplied input modalities, context capacity, default output cap, and reasoning choices. Missing metadata and prices remain unknown. Declared capacity is not a quality or account-availability claim. Both command selection and composer selection use the same directory and RPC.

Mode choice remains process-local. Restart restores the deployment default; existing request events preserve the last request route, not the user's mode choice. The UI states this limitation, and no session-format event is added.

## Alternatives considered

**Rename automatic routing without changing admission.** Rejected because a coordinator-pinned deployment would continue to defeat adaptive classification.

**Implement a new fusion orchestrator behind the menu.** Rejected because configured roles do not imply parallel inference, aggregation, or validated reviews. The selector must not advertise those behaviors without execution contracts.

**Persist a new session event for mode choice.** Deferred because older readers and rollback compatibility require a separate session-format decision. The current UI discloses the process lifetime instead.

**Infer prices and capabilities from model names.** Rejected because the same model identifier can use different providers, accounts, and effective settings.

## Consequences

Selection now expresses distinct admission behavior without creating another directory or changing model permissions. An unavailable declared model fails before inference. Account quota and provider-specific parameter behavior still require separate live validation. Durable mode selection and guaranteed collective execution remain outside this feature.

## Testing

Focused client tests cover search, metadata absence, keyboard interaction, and mode submission. Host tests cover routing and stale-queue invalidation; a real Loader composition exercises the gateway and agent loop with a synthetic provider. Live-provider and assembled-browser evidence belongs to the deployment report rather than these keyless contracts.
