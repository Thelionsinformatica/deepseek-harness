# Agent Note: Leon collective runtime

Status: proposed

English | [中文](2026-09-06-leon-collective-runtime.zh.md)

## Problem

Agent Teams provides a durable board and mailbox, but owner completion and advisory write scopes do not establish verified mission execution. The existing Team domain remains authoritative; this proposal does not supersede its roster or persistence decisions.

## Proposal

Keep a separate experimental composition with one Lead and two workers. Add mission authorization, persistent STOP and inference budgets before enabling real local execution. Retain the native Team task journal rather than maintaining a second task database. Keep the normal Leon composition unchanged.

The first implemented extension is `completionRequiresReview` in the Team service. Its host-only reviewer runs inside the task transaction after revision and ownership checks. Missing or revoked registration rejects completion. Evidence verification and bounded reviewer execution remain responsibilities of the experimental mission owner.

The optional `./mission-control` entry persists scope, terminal STOP, deadline, criteria and atomic call reservations through native storage-domain. The isolated import lab now connects `./execution` to native streaming, final tool guards and cancellation. It exposes only bounded policy tools, not arbitrary subprocesses. A single-process owner lock prevents two lab runners sharing state. The normal composition remains unchanged.

## Alternatives considered

The implemented control path gives terminal STOP priority over stale inference revisions. Verifier exceptions pause without granting approval or renewing limits; concurrent STOP invalidates either review outcome. The gateway also treats unclassified tool results as new protected context for automatic external fallback, rather than trusting an incomplete tool-name list. These controls do not establish model autonomy, crash recovery, or permission for arbitrary tool networking.

**Prompt-only review:** rejected because direct task updates can bypass a model instruction.

**Independent task database:** rejected because duplicate authoritative task state requires reconciliation and weakens native revision checks.

## Acceptance criteria

The runtime must demonstrate separate worker sessions, peer evidence affecting another worker, verified completion, local-only inference, bounded generation and STOP surviving restart. The deterministic Loader mission checks two sessions, actual task completion and worker verification after peer receipt. Separate Qwen runs must establish model performance; deterministic success is not that proof. General-purpose missions, memory promotion and UI expansion remain proposed.

## Risks

A host reviewer is trusted code, not proof by itself. It must validate exact current evidence and must not call a Team mutation while holding the Team transaction. Reinstalling a reviewer must not revive a revoked in-flight decision. Activating the collective before resource, write and recovery enforcement would expose an incomplete safety model.
