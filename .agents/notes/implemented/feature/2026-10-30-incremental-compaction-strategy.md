# Agent Note: Incremental compaction that preserves the cached request prefix

Status: implemented

English | [中文](2026-10-30-incremental-compaction-strategy.zh.md)

## Problem

The basic compaction backend folded the whole eligible span into one checkpoint on every condensation. Every condensation therefore rewrote the earliest part of the model request, so the provider re-read that prefix and the prompt cache restarted from the new checkpoint. Long sessions — the deployment shape this backend is tuned for — paid that prefix rewrite on each condensation instead of only once.

## Decision

[`compaction-basic`](../../../../packages/compaction/compaction-basic/README.md) gains an opt-in `strategy: incremental`. Range selection starts after the newest retained checkpoint instead of at the first surface message, so a condensation only folds the messages that arrived after that checkpoint. Earlier checkpoints keep their positions and text, the request prefix ends with them and stays byte-identical across condensations, and only the freshly folded span invalidates cache state.

Checkpoint depth is bounded by `maxGenerations` (default 8). When the retained checkpoints reach that cap, the next selection falls back to the full cumulative span, folding the whole chain into one checkpoint and starting a new generation. The rare reset pays the prefix rewrite that every condensation used to pay; without the cap, summary tokens would accumulate without bound.

Both automatic pressure condensation and `/compact` pass the resolved strategy into range selection. Explicit-range `compactRegion` callers are unaffected: they name the span themselves. The default stays `cumulative`, so shipped profiles keep their history shape and the change is opt-in per composition.

## Alternatives considered

**Make incremental the default.** Rejected: it changes the history shape of every existing profile, retains several summaries instead of one, and can require more condensation attempts for the same pressure. Defaults in this repository are evidence-gated, so the feature ships behind an explicit field.

**Add the field to the per-model policy table.** Rejected for now: the strategy describes how a deployment reads history, not what one model route can afford; splitting it per route would allow two incompatible history shapes in one session.

**Ship a separate provider package.** Rejected: the transaction, pairing, stability, summarization, and durability machinery already exist in this package, and duplicating it to vary one selection rule would fork the backend's correctness obligations.

**Fold summaries into summaries without a cap.** Rejected: checkpoint tokens would grow monotonically in the request with nothing to force a reset, so the request would eventually lose the savings the strategy exists to produce.

## Consequences

- Incremental condensation frees fewer tokens per run than a cumulative one; a tight `thresholdRatio` may need a higher `compactionRetries` before pressure clears.
- Up to `maxGenerations` checkpoint messages remain on the surface; their combined tokens are small compared with the raw spans they replace, but they are not free.
- The generation reset at the cap is the only incremental path that rewrites the prefix, and it happens once per `maxGenerations` condensations.
- A resumed session keeps whichever strategy its configuration currently resolves; the history written so far remains readable by both strategies.

## Verification

- `vitest run packages/compaction/compaction-basic` — 176 tests, including seven new ones covering selection after the newest checkpoint, the pre-checkpoint fallback, the no-new-material decline, the generation-cap fallback, config validation, and an engine run whose second summary contains only post-checkpoint messages while the first checkpoint stays on the surface.
- `pnpm run typecheck`, `pnpm run build`, and `pnpm run lint` cover the changed package surface.
- The generated configuration catalog records `strategy` and `maxGenerations`; the package README pair documents the behavior, the cache effect, and the retry caveat.
