# Agent Note: Truncated goal continuation

Status: implemented

English | [中文](2026-09-20-truncated-goal-continuation.zh.md)

## Problem

The goal driver disarmed on `max-tokens` while retaining an active durable goal. Output truncation therefore left unfinished work without automatic continuation.

## Decision

Output truncation sets the existing checkpoint obligation instead of disarming. The existing idle scheduler admits another numbered round only under its phase, activation, revision and persisted round-cap checks. It retains session history and does not mark tasks complete. Provider errors and cancellation retain their existing behavior.

## Alternatives considered

**Increase output limits:** this moves the interruption rather than recovering from it and changes model resource use.

**Add a separate retry loop:** this duplicates admission and cancellation logic and risks bypassing the round cap.

## Consequences

Continuation can consume additional model calls within the existing round allowance. There is no new progress detector or unlimited retry. Scripted real-loop tests verify retained history, cap exhaustion and pause before truncated-turn settlement; they do not establish live provider recovery or deployment to a running service.
