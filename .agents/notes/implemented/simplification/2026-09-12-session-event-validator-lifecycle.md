# Agent Note: Shared session event validator lifecycle

Status: implemented

English | [中文](2026-09-12-session-event-validator-lifecycle.zh.md)

## Problem

Plan-mode and web-access companions duplicate retained-history replay, session creation handling and pre-dispatch interception. Independent copies can drift in timing or disposal and permit invalid events to reach the committed log.

## Decision

The Session invariant entry exports a small stateless lifecycle helper. Consumers retain event selection, payload validation, package registration and their bound failure reporter. The helper owns iteration of retained sessions, creation-seed validation and pre-dispatch observation under the registering child context. Disposal removes its listeners. It does not store projection state or alter acceptance rules.

## Alternatives considered

**Extracting into the invariant registry** requires an inverse product dependency on Session or a generic callback API with no other consumer. Session already owns the lifecycle observed by both companions.

**Suppressing the clone detector** retains the duplicated ownership and permits future behavioral drift. Formatting changes cannot establish a shared lifecycle.

## Consequences

No package dependency, persistence format, event semantics, verifier threshold or runtime setting changes. Stateless validators must be synchronous and side-effect free; stateful invariants still own their committed-event transitions. Focused tests exercise old history, new seeded sessions, rejection before append and downstream observation, failed installation cleanup, disposal and reload. Existing plan and web behavior tests remain required. There is no model-visible change, so existing transcript snapshots remain applicable without re-recording.
