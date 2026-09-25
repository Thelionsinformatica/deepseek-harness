# Agent Note: Bounded delegation attempts

Status: implemented

English | [中文](2026-09-20-bounded-delegation-attempts.zh.md)

## Problem

A prompt asking for one delegation does not prevent another call after a child fails. A worker's instruction not to write likewise does not remove its write tools.

## Decision

The global-tool restriction below is partially extended by [audit-worker admission](../bug-fix/2026-09-21-audit-worker-admission.md): evidence-required in-process audits also enforce their host filter on child-scoped and nested execution. The budget mechanism remains unchanged.

The optional `maxCallsPerSession` in `tool-subagent` admits attempts by their position in the calling session's ordered tool-call history. Failed attempts consume budget. Restored events retain the same accounting. Missing call records and calls with a recorded result are rejected before provider startup.

Read-only workers use the existing provider `toolFilter` allowlist. The default configuration remains uncapped. The limit covers one tool name in one session, not other delegation tools or follow-up messages. Persistence retains its existing durability guarantees; this is not exactly-once crash recovery.

## Alternatives considered

**Prompt-only restrictions:** the evaluated model repeated delegation and wrote despite instructions, so prose is insufficient enforcement.

**A second persistent counter:** duplicating the session log would add reconciliation work and another authority. Existing ordered events already identify attempts.

## Consequences

The host can configure bounded isolated evaluations without changing normal delegation. Restored and concurrent attempts have deterministic admission. Tests run actual parent and child loops with a scripted model, verify rejected writes and repeated delegation, and do not establish live model competence.
