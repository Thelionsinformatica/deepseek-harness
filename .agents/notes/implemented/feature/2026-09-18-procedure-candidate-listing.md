# Agent Note: Read-only procedure candidate listing

Status: implemented

English | [中文](2026-09-18-procedure-candidate-listing.zh.md)

## Problem

A durable procedure candidate created by `procedure_propose` was discoverable only through the id returned in that same turn. A user who wanted to review pending candidates later had no model-facing way to list them, which pushed review tracking outside the workspace record.

## Decision

`ProcedureLearningService` exposes `listCandidates`, returning candidate records for the current workspace ordered by recency. The `procedure_candidates` tool publishes that list to the model as a read-only query: it does not approve, execute, or mutate memory or skills, and entries leave the list when a human review resolves them. Review still requires the exact `/procedure-review` command.

## Alternatives considered

Surfacing candidates through general memory search was rejected because review state is a procedure concern, not a retrieval concern, and search ranking would hide the exact pending set. Auto-promoting listed candidates was rejected because human review is the promotion authority.

## Consequences

The pending-review set is reconstructable inside the session and covered by a keyless headless snapshot. Acceptance and rejection behavior is unchanged.
