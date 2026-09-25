# Agent Note: Audit-worker evidence and request admission

Status: implemented

English | [中文](2026-09-21-audit-worker-admission.zh.md)

## Problem

A worker can finish generating an audit without executing any inspection, receive write tools despite a read-only prompt, or exceed its model's context before doing useful work. These failures must not become accepted findings or unbounded retries.

## Decision

Host-configured `evidenceTools` adds an optional evidence assessment separate from the child's actual stop reason. The assessment uses eligible successful call/result pairs from the latest turn in the current activation suffix. Inherited history, earlier turns, orphan results, streaming chunks and duplicate calls do not establish current evidence. An observed pair remains semantically unverified: the parent must check the cited events and conclusions.

Foreground results and one-shot jobs reject missing required evidence while preserving partial output. Continuable reports and settlement notices carry host-authored evidence status. The policy persists in version 3 descriptors; ordinary children retain version 2. Resume restores the policy but requires evidence from the new activation. Model arguments cannot replace host configuration.

When evidence policy and a tool filter are combined, the in-process child receives a monotonic execution guard, including child-scoped additions and nested dispatch. Leon's dedicated `subagent_audit` exposes `read`, `grep`, and `glob`, requires `read` or `grep` evidence, and caps initial calls at two per tool per session. It uses native tools and ordinary final answers; the filter also excludes `report`, structured output and code-mode execution. General delegation remains available for implementation. The coordinator is instructed to choose the audit tool; this is not a classifier that forces all semantic audit requests through it.

This partially extends [bounded delegation attempts](../feature/2026-09-20-bounded-delegation-attempts.md), whose event-based budget remains authoritative. It does not replace completion review, artifact verification, or their acceptance criteria.

Automatic compaction installs request admission immediately before adapter dispatch. The LLM service supplies effective options and metadata bound to the prepared adapter, avoiding a later registry replacement's capacity. Admission follows the canonical scope chain: host listeners apply globally, and agent/preset listeners apply only to that scope and its descendants. The loop prepares and dispatches through the calling agent's context to retain that identity. Estimated input, tool schemas and output reserve must fit the known window. Refusal preserves history and mandatory instructions; it does not trim them or increase limits. The policy remains in `compaction-basic`, not the agent loop.

## Alternatives considered

**Prompt-only read-only and evidence instructions:** they do not prevent writes or invented inspection. Host execution policy and event linkage provide enforceable boundaries.

**Require tools for every child:** simple conversation and general implementation have different contracts. Evidence admission is opt-in and uses a separate audit instance.

**Increase context or silently retry elsewhere:** this conceals excess input and may change cost or consent. Refuse oversized known-capacity requests without changing route or budget.

**Treat tool use as approval:** a successful read does not establish a correct conclusion. Keep observation and semantic verification separate.

## Consequences

The controls improve failure classification without adding models, automatic memory, or a new task database. Initial-call budgets do not cover other delegation tools or later follow-ups. Eligible tools and host plugins are trusted implementations, not an operating-system sandbox.

Admission is an estimate rather than provider-tokenizer proof. Unknown model capacity remains the adapter's responsibility. The keyless tests use real Loader, loop, tools and persistence with scripted adapters; they do not establish live-model competence. Source validation does not activate the running host. Leon's engineering skill now calls out build-producing lint/typecheck scripts and requires isolation or controlled activation instead of rebuilding a live host.
