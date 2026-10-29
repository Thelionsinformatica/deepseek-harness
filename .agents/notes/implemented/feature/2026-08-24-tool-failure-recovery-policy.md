# Agent Note: Repeated tool failure recovery policy

Status: implemented

English | [中文](2026-08-24-tool-failure-recovery-policy.zh.md)

## Problem

A tool error currently returns to the model as a logged `tool/result`, but nothing deterministic prevents the model from submitting the exact failing call again. Provider reasoning alone is unreliable here: repeated shell, filesystem, or browser failures can consume time and tokens while producing no new evidence. The existing repeat-tool reminder is advisory and was designed for identical calls regardless of outcome, so using it for failures would either remain too weak or create overlapping messages with a stronger recovery policy.

## Decision

Ship `@deepseek-ai/dsh-failure-recovery-policy` in the base bundle and the ACP example with `maxEquivalentFailures: 2`. The plugin observes top-level model-requested calls per live agent. It matches an exact tool name plus canonical arguments and an equivalent final failure identity. After the second equivalent failure it injects one compact, source-attributed recovery notice through `additionalContexts`; the normal agent loop logs that notice as `user/message`. If the next request is still the same exact call, a monotonic `ctx.tools.guard()` denies it before the tool implementation executes.

The lock never blocks progress: another tool, changed arguments, a different failure, success, or a new user prompt begins a fresh chain. Direct tool calls and nested Code Mode calls stay outside the policy. Raw arguments and unstructured error messages remain in their existing audited tool results and are not duplicated into recovery guidance. Denied tokens are removed from observation so the guard cannot create an ever-growing self-denial chain.

The base bundle now owns the JSON storage hub and domain form for every host mode. The policy stores each session's chain in one schema-validated recovery record; the domain's atomic per-record mutation serializes concurrent completions and makes the record available after host or session resume. Provider/model identity is absent from the recovery key, so adaptive routing cannot erase the chain.

The package also publishes the code-owned `ToolPolicy`, structured `InvocationOutcome`, immutable `RecoveryEvent`, and `AtomicRecoveryStore` interfaces. The durable and memory implementations deduplicate event ids and issue TTL leases with monotonic fencing tokens. These contracts let effectful adapters add idempotency and uncertain-outcome reconciliation without giving the model control of effect or retry classification; the exact-failure guard does not reserve every call yet.

`repeat-tool-reminder` now tracks successful calls only. Failed or downstream-blocked calls reset its advisory chain, leaving one owner and one message for each outcome family.

## Verification

Focused integration tests mount the production agent loop, tools service, storage domain, mock model adapter, and both guard plugins. They prove the notice after two equivalent failures, denial before a third dispatch, preservation of downstream context, isolation by agent, resets on success and user input, changed-call recovery, wildcard exclusions, direct-call exclusion, nested-call exclusion, and absence of duplicate successful-repeat reminders. Atomic-store tests prove concurrent failure increments, replay deduplication, durable reopen, exclusive lease ownership, expiry takeover, and stale fencing-token rejection. The shipped ACP composition snapshot exercises a real failing tool sequence and pins the logged recovery context and denied result.

## Alternatives considered

**Force a hidden or visible chain-of-thought step** — rejected. Recovery asks for a different observable strategy without requiring private reasoning or adding unverifiable prose to the audit trail.

**Turn the existing advisory reminder into a mixed success/failure policy** — rejected. Successful idempotent polling and equivalent failures need different escalation semantics; separate plugins keep configuration and ownership clear.

**Block the second failure attempt** — rejected. One retry can be useful for transient errors. The second equivalent failure is observed and logged; only a later unchanged dispatch is denied.

**Use fuzzy matching for arguments or errors** — rejected pending evidence. Exact canonical identity is predictable, allows intentional parameter changes, and avoids false positives on legitimate retries.

## Consequences

Leon now stops one common non-progress loop deterministically while retaining the complete original results for audit and model context. The base policy costs no model tokens until the configured threshold, then adds one compact append-only message. It does not alter model routing, provider failover, or transport retries.

The exact-failure chain survives restart and session resume through the configured domain backend. Calls already admitted in one parallel batch can finish before accumulated failures take effect, although their completions are serialized without lost counts. The JSON backend coordinates one host process; cross-process dispatch coordination remains a backend capability, not a claim of this implementation.
