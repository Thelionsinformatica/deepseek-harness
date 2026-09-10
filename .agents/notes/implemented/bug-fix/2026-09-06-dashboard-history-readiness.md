# Agent Note: Dashboard history readiness and partial costs

Status: implemented

English | [中文](2026-09-06-dashboard-history-readiness.zh.md)

## Problem

A conversation with an unreadable history can display a ready HUD. Narrow metric cards can hide the warning that an API estimate excludes unpriced calls.

## Decision

The activity projection treats `openError` as a session error. Dashboard copy identifies API estimates rather than invoices; labels and caveats wrap within responsive cards. Persisted events and their validation remain unchanged.

## Alternatives considered

**Ignoring unknown events** can lose model-visible history and is not a recovery mechanism. Server and client artifacts must be deployed together instead.

**Tooltip-only cost warnings** hide essential uncertainty from ordinary viewing and touch users.

## Consequences

Cards may occupy more vertical space. Focused component regressions cover the error state and partial-cost wording; built-browser inspection verifies wrapping. These changes neither price unknown calls nor prove agent task quality.
