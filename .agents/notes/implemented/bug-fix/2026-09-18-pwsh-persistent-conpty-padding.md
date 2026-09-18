# Agent Note: Persistent pwsh output carried ConPTY padding rows

Status: implemented

English | [中文](2026-09-18-pwsh-persistent-conpty-padding.zh.md)

## Problem

Under load, the persistent pwsh tool could return captured command output prefixed with whitespace-only rows — ConPTY visual padding retained in scrollback between the real START marker and the first line of command output. The extraction already trimmed horizontal padding after the completion status digits but not padding lines before output, so a strict consumer observed a stray `   \n` prefix.

## Decision

`commandOutput` strips leading whitespace-only lines only when followed by real output. A command whose entire output is whitespace keeps it, matching the existing status-line padding precedent.

## Verification

`loader-composition.spec.ts` passes under the same parallel aggregate load that produced the artifact (7 files, 129 tests), and in isolation. The functional contract — a respawned shell starts from the workspace — was already holding; the fix removes extraction noise.

## Alternatives considered

Trimming all leading whitespace unconditionally could eat a genuine whitespace-only first line. Treating it as a test flake left a real fidelity leak in model-visible output.

## Consequences

Extraction is marginally more permissive about terminal rendering artifacts. Marker anchoring, wrapper stripping, and the whitespace-only-output edge case are unchanged.
