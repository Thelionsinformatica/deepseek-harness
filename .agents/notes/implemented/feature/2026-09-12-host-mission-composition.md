# Agent Note: Host-assigned mission composition before inference

Status: implemented

English | [中文](2026-09-12-host-mission-composition.zh.md)

## Problem

The [persistent reviewer identity rule](../bug-fix/2026-09-12-mission-reviewer-session-identity.md) requires an existing teammate session, but native roster provisioning assigns its UUID and immediately schedules an initial prompt. The host needs to finish assigning functional identities before that prompt can reserve a model call. Display labels cannot fill that authorization gap.

## Decision

Optional `hostComposition` belongs to the existing mission-control deployment. The host creates exactly two continuable workers through `provisionTeam`, assigning researcher and checker functions to their returned native session IDs. Provisioning state and assignments live in the mission record beside its immutable allowance and deadline; tasks remain solely in the native Team journal. Ready bindings must match the complete three-session roster and exclude duplicate IDs, provisioning failures and additional members. Model/tool initiator scope cannot assign functions. Existing static reviewer-ID configurations remain supported.

Execution waits for ready bindings at request/stream admission, after the initial user message is durable and before the inference slot or budget reservation. The optional checker-function reserve resolves to the saved ID; the experimental eight-call variant does not change the 48-call allowance or fifteen-minute deadline. Rejected admission does not spend a call. STOP/pause aborts pending provisioning, preserves partial sessions and prevents late activation from reopening admission. Shutdown waits for cancelled provisioning before closing storage.

Resume validates the stored bindings without provisioning again. A persisted provisioning state without this process's admitted provisioning operation is incomplete, not evidence of a running process. It cannot reset limits or create replacement workers automatically. A paused mission stays paused until the host resumes it. Loading a running mission can still recover previously accepted inbox work; role restoration alone is not a promise of zero model calls in that case.

Offline inspection and STOP therefore read the existing mission table without creating an agent. `inspectStored` does not write; `stopStored` requires an inactive root and commits terminal cancellation without lifecycle notifications. Both operations retain owner/workspace checks and reject model/tool initiator scope. The host's exclusive directory lock remains necessary; this is not cross-process coordination.

## Alternatives considered

**Wait in the pre-step hook.** Inbox claim precedes that hook, but durable user-message append follows it. Native provisioning waits for a pending or durable initial message, so delaying pre-step can deadlock the host's own bootstrap.

**Mount execution after creating workers.** A worker can reach inference before its guard exists, and already-running waterfall chains need not incorporate listeners mounted later.

**Introduce another task or role database.** Native Team journals and the existing mission domain already own the required records; another authoritative database would add recovery ambiguity.

## Consequences

The experimental runtime can establish functional identity with zero adapter requests before all participants are bound. Host-only direct reservations also reject incomplete composition. The feature does not authorize shell access, improve model reasoning, approve an artifact, complete a task or renew budgets. Failure remains inspectable, and incomplete crash recovery deliberately requires operator reconciliation.

## Verification

Focused source tests use real native sessions, roster, persistence, mission storage and execution guards with a scripted adapter. They cover pre-inference durability, display-name impersonation, checker-only reserve, participant self-assignment, extras, ready cold resume, orphan provisioning, STOP retention and disposal. Offline tests check unchanged inspection bytes, zero agent activation, idempotent STOP and reloaded terminal state. These tests establish runtime behavior, not GPU performance; the owning runnable example provides assembled Loader coverage.
