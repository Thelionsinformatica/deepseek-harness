# Agent Note: Workspace-isolated human review for memory candidates

Status: implemented

English | [中文](2026-08-25-memory-candidate-human-review.zh.md)

## Problem

Shadow extraction produced useful local candidates, but an operator could not inspect or decide them through the Leon interface. Exposing the storage table directly would leak internal ownership identifiers and allow one browser tab to replace another decision. Treating approval as permission to write final memory would also collapse two different safety gates.

## Decision

- `MemoryCandidateReviewService` owns the canonical `memory_candidate.candidates` domain and exposes generated `list` and `markReviewed` Remote methods.
- Every operation accepts a Session id rather than a workspace id. The Host resolves a live or persisted Session to its registered workspace and enforces that partition before returning or mutating a candidate.
- Browser projections omit internal `workspaceId` and `userId`. The Web client receives only the review content and safe decision metadata.
- Review writes are serialized per candidate. Repeating the same decision is idempotent, while replacing an existing decision with a conflicting one fails.
- Blocked, policy-rejected, and content-free rows cannot be accepted.
- The Leon Work session header includes a local review modal with approve, reject, loading, empty, and retry states. The modal says explicitly that approval records a decision only.
- Review never calls `ctx.memory.create()` and never injects candidates into model context. Final persistence remains a later, separately validated stage.

## Verification

Host integration coverage proves approve and reject recording, timestamps and reviewer identity, idempotency, conflicting-decision refusal, cross-workspace refusal, browser projection redaction, and zero final-memory writes. Browser component coverage proves on-demand loading, visible category and confidence, approve and reject actions, disabled approval for ineligible rows, empty state, and retry after a local failure. The Host build generates the published `review.js` entry and the Typert Client contract imports only the client-safe `types` subpath.

## Alternatives considered

**Expose the storage domain directly to the browser.** Rejected because storage rows contain internal ownership identifiers and the browser must not choose its own workspace boundary.

**Use a workspace id supplied by the browser.** Rejected because a Session is the existing user-visible authority anchor and lets the Host derive ownership instead of trusting a caller-provided partition.

**Write final memory immediately after approval.** Rejected because review and durable-memory validation are separate controls; combining them would make the first UI release irreversible.

## Consequences

Leon now has a visible, local, auditable human decision flow without silent learning. A reviewed candidate remains in the shadow domain as evidence and does not yet improve future recall. The later persistence stage must consume only accepted rows, revalidate content and scope, and retain a reversible audit trail.
