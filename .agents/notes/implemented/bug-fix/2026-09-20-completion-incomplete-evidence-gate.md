# Agent Note: Completion review evidence and checklist ordering

Status: implemented

English | [中文](2026-09-20-completion-incomplete-evidence-gate.zh.md)

## Problem

An auditor could accept an incomplete trace. A review todo also required completion before the very operation that starts its review, encouraging false checklist completion.

## Decision

The external-write limitation below is partially superseded by [artifact freshness checks](2026-09-21-completion-audit-boundaries.md): current receipts recheck the files actually delivered to the auditor, without claiming a workspace lock. Ordering and paginated evidence rules remain active.

The explicit review action leaves goal and todo state unchanged. A PASS is reusable only within the same turn, goal revision and unchanged checklist content, without intervening work tools. Completed todos remain required by completion. Results return the auditor session and bounded summary; durable receipts remain content-free and hash-bound to their original evidence interval.

Oversized evidence is paginated under the existing per-delivery character bound. The host requires every page to be delivered before accepting PASS. Exact auditor identity owns access until settlement. Parent calls/results and direct-child execution come from live sessions and optional persistence, never from model-selected paths. Source records remain intact.

## Alternatives considered

Automatically completing a review todo conceals unfinished work. Repeating the auditor after bookkeeping duplicates cost. Silently truncating evidence enables unsupported approval. The host instead exposes explicit review and rejects stale or undelivered evidence.

## Consequences

Focused and Loader tests cover ordering, freshness, page delivery, expiry and bounded output. The ACP application snapshot exercises review with a pending checklist item, subsequent checklist completion, and one auditor only. Pagination adds reader calls for large evidence. Coverage is direct-child only; missing persistence is explicitly classified. Delivery does not establish understanding, and external writes outside agent tools are not detected by same-turn reuse. Live model evidence is recorded separately from these deterministic tests.
