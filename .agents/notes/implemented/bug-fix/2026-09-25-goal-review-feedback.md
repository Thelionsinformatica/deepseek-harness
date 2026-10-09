# Agent Note: Actionable completion feedback and assigned evidence pages

Status: implemented

English | [中文](2026-09-25-goal-review-feedback.zh.md)

## Problem

A real completion run repeated the same rejected call after PASS because review bookkeeping remained unfinished. The auditor also requested an unassigned evidence page while its complete trace was already inline. Correct refusal preserved safety, but advertised capabilities and feedback invited avoidable calls.

## Decision

The [goal tools](../../../../packages/goal/tool-goal/README.md) return host-authored `review.nextAction` after explicit review and name `todo_write` in both policy and unfinished-list errors. Feedback preserves the full canonical list and instructs the executor to record only genuinely finished work. No status is inferred or changed automatically.

The auditor prompt identifies inline or paginated delivery. Only paginated reviews advertise and permit `completion_evidence_read`, including when deployment verifier names contain that tool. Execution guards, assigned-agent access, page completeness, artifact freshness and same-turn reuse checks remain enforced.

This supplements [checklist ordering and evidence delivery](2026-09-20-completion-incomplete-evidence-gate.md) and [auditor capability restrictions](2026-09-21-completion-audit-boundaries.md). Both records remain active: their authority, ownership and freshness decisions are not superseded.

## Alternatives considered

**Automatically finish review todos:** the host cannot infer which items are merely bookkeeping or genuinely done. Automatic completion would conceal unfinished requirements.

**Leave an unavailable page tool advertised:** the access guard still refuses it, but coherent schemas and explicit delivery instructions avoid inviting a doomed call. Removing the tool universally would break paginated review.

**Suppress every repeated completion call:** an execution-time refusal already blocks the mutation; it cannot prevent a model from producing another call. Feedback improves recovery without inventing scheduling authority or changing limits.

## Consequences

Review feedback adds a small fixed output cost. Reduced repetition is a model-behavior objective, not a guarantee. Incorrect completion remains rejected, and changed work or requirements still need fresh review. Existing model routes and limits are unchanged.

## Testing

Focused tests exercise duplicate incomplete calls, unchanged checklist status after PASS, fresh-review requirements, paginated reads, incomplete delivery and expired access. The keyless headless snapshot boots the real Loader, loop, filesystem, spawned auditor and persistence: unassigned pages are absent from schemas, a fabricated call is denied, repeated completion is rejected, and explicit status-only bookkeeping permits one-audit completion. Scripted adapters prove wiring and recorded feedback, not live model compliance or production activation.
