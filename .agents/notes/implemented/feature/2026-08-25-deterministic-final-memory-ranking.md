# Agent Note: Deterministic final memory ranking

Status: implemented

English | [中文](2026-08-25-deterministic-final-memory-ranking.zh.md)

## Problem

Lexical and optional semantic providers can assign scores on different scales, return duplicate or malformed hits, and omit the durable signals that distinguish a recent reviewed decision from an old unconfirmed fact. Passing provider order directly to explicit search and automatic recall made model changes and retrieval-provider changes capable of producing inconsistent context.

## Decision

`dsh-tool-memory` owns one provider-independent final ranking stage shared by `memory_search` and automatic recall. Each operation over-fetches at most three times its requested result count, capped at 50 provider hits, then rejects non-finite scores, cross-workspace records, empty content, invalid revisions or timestamps, invalid optional metadata, and unknown confirmation classes. Duplicate ids retain the highest revision, then the greater provider score, then the newer update.

The final score normalizes non-negative provider relevance within the candidate set and weights it at 55%. Exponential recency contributes 20% with a configurable 30-day half-life, normalized importance contributes 15%, and confirmation multiplied by source confidence contributes 10%. Reviewed memories score 1 for confirmation, explicit memories score 0.9, and legacy memories use neutral importance and confirmation values of 0.5. Stable ties resolve by final score, update time, then id.

The provider-neutral memory API accepts optional zero-to-one `importance` and `confidence` values plus an `explicit` or `reviewed` confirmation class. The local provider persists them without a durable schema migration because every field is optional and legacy records remain valid. Explicit tool writes carry full confidence with `explicit` confirmation; approved automatic writes retain extracted importance and confidence with `reviewed` confirmation.

The Leon preset pins the weights explicitly. Setting `ranking.enabled: false` retains validation, workspace filtering, deduplication, sensitive filtering, result bounds, and context bounds but orders retained hits by provider score. Disabling local semantic retrieval is independent and does not remove ranking metadata.

## Verification

Focused tests cover score components, legacy defaults, deterministic ties, duplicate revisions and scores, malformed and cross-workspace provider output, result caps, provider-score rollback, invalid configuration, durable metadata, bounded over-fetching, and the automatic-recall character budget. The eight memory test files pass 112 runtime cases, and the changed memory packages plus the Leon CLI compile together.

## Alternatives considered

**Use provider order directly.** Rejected as the default because lexical and semantic scores do not provide a stable common meaning and cannot incorporate durable confirmation or importance. It remains the configuration rollback.

**Ask the conversational model to rerank.** Rejected because it adds API cost and latency, exposes more memory text to the selected model, and makes ordering dependent on which local or remote model handles the turn.

**Persist one provider-specific final score.** Rejected because relevance is query-dependent and would couple durable memory to one embedding model or lexical implementation.

## Consequences

Leon receives stable, bounded memory context when the conversational model or retrieval provider changes, while reviewed and recent facts can outrank weak legacy matches. The final score is intentionally heuristic: LEON-EVAL-PTBR must calibrate its weights against representative Portuguese tasks. Temporal status, expiry, and supersession remain separate filtering work; this ranking does not infer them from age.
