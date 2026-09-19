# Agent Note: Retry host pause after concurrent reservations

Status: implemented

English | [中文](2026-09-07-pause-reservation-race.zh.md)

## Problem

A stdin pause can read a mission revision immediately before a worker reserves a call. The stale transition is rejected and merely logged, leaving the mission running.

## Decision

The laboratory CLI retries only stale pause revisions while the mission remains running. Attempts are bounded by its remaining call allowance plus one. It acknowledges only committed transitions. The mission service retains its revision checks; STOP and resume do not acquire a new retry policy.

## Alternatives considered

**Remove revision checks:** would weaken callers that rely on rejecting stale controls.

**Retry every error:** could hide terminal state or authorization failures.

## Consequences

The controlled two-worker probe pauses at six calls and resumes in a new process to completion at 31, preserving deadline and tasks. This proves one controlled recovery, not power-loss recovery or arbitrary concurrent hosts. The normal profile remains unchanged.
