# Agent Note: Team provider admission

Status: implemented

English | [中文](2026-09-06-team-provider-admission.zh.md)

## Problem

An unavailable provider consumes an immutable teammate name and slot. Advertising unavailable creation modes invites repeated failures.

## Decision

The roster checks continuable capability before its provisioning record. Tool schemas refresh on provider registration changes and expose only available creation modes. Admission remains enforced for direct service callers.

## Alternatives considered

**Deleting failed members** discards real provisioning evidence and weakens immutable identities. Post-admission failures remain recorded.

**Prompt-only restrictions** cannot prevent direct callers from consuming slots.

## Consequences

Provider removal after admission can still produce a durable failure. Unit regressions cover missing providers, successful name reuse after rejected admission, provider removal and retained post-admission failures. Model-quality comparison and final-review budgeting remain separate validation work.
