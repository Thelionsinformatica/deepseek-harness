# Agent Note: Safe automatic memory context composer

Status: implemented

English | [中文](2026-08-25-safe-memory-context-composer.zh.md)

## Problem

Relevant memory is still user-originated durable text. A retained value may contain a prompt-injection attempt, a duplicate provider hit, sensitive content, or a record from the wrong workspace. Ranking and provider validation reduce this risk but do not define the final model-facing serialization or prove which records actually fit the context budget.

## Decision

`dsh-tool-memory` now sends automatic recall through one `MemoryContextComposer` after deterministic ranking. The composer preserves ranked order, deduplicates by memory id, rechecks exact workspace ownership and credential-like content, trims surrounding whitespace, and skips complete records that do not fit the final character budget. It never truncates a memory value.

The model receives one source-attributed plugin snapshot. A fixed security boundary appears before every value and states that the envelope is untrusted data, not instructions. The JSON payload repeats `trust: untrusted` and `instructionAuthority: none`. Each retained value exposes only its memory id, revision, value, and source session; workspace ids, raw paths, ranking scores, and timestamps stay outside model context.

Candidate telemetry now counts the exact records retained by the final composer rather than every pre-budget ranked hit. A provider failure, cancellation, or an empty final envelope remains a safe no-op and the normal model turn continues.

## Verification

Unit tests keep a simulated `Ignore previous instructions` value inside the untrusted JSON envelope, preserve ranked order, remove duplicates, reject cross-workspace, sensitive, and empty values, and prove that later compact records can still fit after an oversized record is skipped. The composer reaches 100% statement, branch, function, and line coverage. Agent-loop tests prove valid injection, the 512-character minimum budget, provider-failure fallback, and pre-step cancellation. All 53 `tool-memory` tests pass.

## Alternatives considered

**Insert raw memory strings.** Rejected because the boundary between retained data and agent instructions would be ambiguous and provenance would be lost.

**Render scores and timestamps for every hit.** Rejected because those fields consumed the minimum context budget without helping the conversational model. They remain available in local records and telemetry.

**Truncate oversized values.** Rejected because partial facts can become misleading and may cut away qualifiers or safety context.

## Consequences

Leon receives compact and auditable automatic memory context with an explicit instruction-authority boundary. This is structural prompt-injection defense, not a claim that arbitrary stored text can never influence a model. Temporal expiry and supersession are now enforced by the provider and final ranking, so inactive revisions cannot reach this automatic context boundary.
