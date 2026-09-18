# Agent Note: Revision confirmation and image-aware compaction admission

Status: implemented

English | [中文](2026-09-15-memory-confirmation-and-compaction-admission.zh.md)

## Problem

A corrected memory inherited confirmation and confidence belonging to different text. A text-only auxiliary summarizer could receive image-bearing history; automatic pressure handling could swallow its LLM error and proceed without a successful checkpoint.

## Decision

Changed memory content loses current confidence and validation in both local history modes. Temporal history retains the original revision. Image-bearing compaction selects only a compatible assigned vision route when the original summary route cannot read images. Range budgeting considers both capacities, and LLM errors propagate from pre-step admission. No new provider or consent is added.

## Verification

Focused memory and compaction suites passed 178 tests. The real Loader personal-memory provider and MCP bridge suites passed another 67 tests, including revision invalidation and an actual stdio server that repeats a pagination cursor. The host build and lint completed successfully. These are keyless tests, not proof of model quality or successful recovery of the user's live session.

## Alternatives considered

Keeping the old confirmation misrepresents the new content. Dropping images or silently changing the coordinator loses evidence or changes user intent. Increasing context and retry budgets would hide incompatible routing rather than repair it.

## Consequences

Existing stored memories are not rewritten or retrospectively verified. Ordinary-chat visual delegation, factual provenance enforcement for newly created memories, and live restart acceptance remain separate work. All pre-existing workspace changes are preserved; no production credentials or model assignments are changed.
