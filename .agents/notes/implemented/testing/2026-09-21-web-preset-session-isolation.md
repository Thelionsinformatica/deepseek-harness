# Agent Note: Web preset tests own their session storage

Status: implemented

English | [中文](2026-09-21-web-preset-session-isolation.zh.md)

## Problem

The shipped Web composition resolves its JSONL session root from `DSH_HOME`. Isolating settings and generic storage alone leaves session appends able to write into an operator's real session history. Random session identifiers avoid collisions but do not isolate those writes.

## Decision

[`bootWeb`](../../../../apps/cli/tests/web-agent-presets.e2e.ts) patches `session-persistence-jsonl.root` to the `sessions` directory beside its temporary settings file before Loader mounts the composition. The real persistence backend and its durability listeners remain active for every helper invocation.

The shared fixture boots with a separate temporary `DSH_HOME` containing a sentinel, then restores the process environment. Its keyless regression appends a preset-selection event, awaits the session flush, reads the expected temporary log file, and verifies its persisted content through the backend's raw-artifact reader. The external home retains only the unchanged sentinel. Removing the root patch makes the expected-file read fail.

## Alternatives considered

**Disable session persistence.** This avoids disk writes but removes the real durability behavior from the assembled composition.

**Make the helper replace `DSH_HOME` with its settings directory.** This hides the independence of the storage roots and interferes with tests that deliberately resolve user presets from a different harness home.

## Consequences

Web preset tests retain real session persistence without inheriting the operator's session directory. The regression uses synthetic data and invokes no model. This decision does not change production paths or remove artifacts left by earlier test runs.
