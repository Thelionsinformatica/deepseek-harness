# Agent Note: Cross-platform CI stability gaps

Status: implemented

English | [中文](2026-09-19-cross-platform-ci-stability.zh.md)

## Problem

The Linux and Windows CI lanes disagreed with the local checkout in several places: absolute paths were interpreted with host-only semantics, artifact claims recognized only Windows paths, a Windows temporary workspace could be misclassified as redirected, concurrent DPAPI subprocess startup could exceed its timeout, and SQLite retry tests used budgets too narrow for instrumented Windows runs. Web snapshot fixtures also depended on an online model catalog, an unavailable Bash presenter on Windows, generated API remote modules, and an undeclared loader fixture dependency.

## Decision

Path validation now accepts either POSIX or Windows absolute syntax regardless of the current host. Import validation compares the canonical final path with the canonical parent plus requested basename, preserving redirect detection without rejecting Windows short/long-path aliases. Windows DPAPI invocations are serialized before their bounded subprocess phase. SQLite retry tests retain their retry assertions with realistic instrumented-run budgets.

Web replay tests use a header-only local model catalog, install a test-only terminal presenter when Bash is unavailable, mock generated API remotes in the source-only dashboard test, declare fixture dependencies explicitly, and carry the current reviewed snapshots.

The documentation build emits its raw Markdown projection once per output directory. VitePress MPA mode invokes `buildEnd` repeatedly in one process; subsequent calls now reuse the first emission instead of treating those generated twins as foreign build-file collisions.

## Verification

The final full unit suite passed 15,047 tests with 79 skipped. The snapshot baseline passed 113 tests with 42 skipped. Focused session, policy, query, completion, Windows persistence, DPAPI, agent-team, Web replay, and dashboard suites passed. Typecheck, lint, build, artifact gates, Windows blocking gates, and two consecutive MPA documentation builds passed. Diff whitespace validation passed.

The repository-wide standard coverage threshold remains a separate pre-existing quality debt; this change does not weaken or bypass that gate.

## Alternatives considered

Broad platform skips would have hidden real portability defects. Increasing all timeouts globally would have masked contention without bounding it. Generating remote modules inside source-only tests would have coupled unit tests to build order. Broad coverage exclusions were rejected because they would redefine the quality contract rather than improve stability.

## Consequences

The affected CI paths are deterministic across Windows and Linux, local replay tests no longer require paid inference, and Windows credential protection avoids concurrent PowerShell startup contention. The normal runtime configuration, model routing, credentials, and user data remain unchanged.
