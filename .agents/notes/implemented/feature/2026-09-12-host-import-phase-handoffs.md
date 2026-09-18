# Agent Note: Host import phase handoffs

Status: implemented

English | [中文](2026-09-12-host-import-phase-handoffs.zh.md)

## Problem

A model turn ending does not prove peer work finished. Repeating identical host requests can exhaust a mission without creating new evidence, and an artifact fix alone does not prove collaboration or valid review.

## Decision

The isolated host variant provisions an investigator and a checker through native TeamService before requesting Lead work. The [laboratory](../../../../examples/headless-agent/README.md) retains 48 calls, a 15-minute deadline and eight checker-only final calls. Its host handoffs inspect artifact digest, native task revisions and verification evidence; an in-process ledger admits each participant/signature combination once. Token counters and time alone cannot renew a request. Only model-invoked native tools submit tasks or create evidence. The existing current-digest verifier decides completion.

## Alternatives considered

**Repeated fixed feedback.** Rejected because an unchanged refusal does not authorize spending more turns. A fresh evidence state permits another bounded request.

**Completing tasks from the host.** Rejected because it would make the comparison reward orchestration shortcuts rather than verified agent work.

## Consequences

The variant can end blocked with a valid artifact and open tasks. It has exactly two teammates, not two investigators plus an additional auditor. The ledger is per process; persisted STOP, deadline, budget and identities survive restart, but this is not abrupt-crash recovery or a generic mission engine. Native Loader tests verify sessions, tool execution, peer evidence and final approval using a deterministic adapter; local-model performance requires a separate preserved attempt.
