# Agent Note: Parent execution evidence for isolated completion review

Status: implemented

English | [中文](2026-09-19-completion-parent-trace.zh.md)

The parent projection described here is supplemented by [paged team review](2026-09-20-completion-incomplete-evidence-gate.md), which delivers direct-child evidence and rejects unread pages.

## Problem

A fresh completion reviewer has no parent conversation history. Its own session searches cannot establish the executor's delegation sequence, even when persisted parent tool results exist.

## Decision

The auditor prompt includes a bounded, hash-labelled projection of parent tool calls and results captured before review starts. It covers only that session, including work before goal creation. Tool text remains untrusted. Oversized traces carry an incomplete marker; no partial event is represented as complete. The child prompt persists through the existing subagent mechanism, without a second evidence store.

## Alternatives considered

**Executor summaries:** they cannot independently establish execution. The projection reads host session events instead.

**Workspace-wide history search:** it exposes unrelated sessions and depends on storage services that the reviewer may not inherit. The projection is scoped to the parent.

## Consequences

Review gains concrete parent call/result evidence at a configurable input cost. It does not prove child-internal operations or grant new filesystem permissions. Existing rejection and freshness checks remain in effect. Focused tests cover bounds, preservation and delivery through Loader composition; live deployment and child-internal evidence remain separate validation work.
