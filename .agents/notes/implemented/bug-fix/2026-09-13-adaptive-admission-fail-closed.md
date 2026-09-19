# Agent Note: Fail closed on adaptive admission errors

Status: implemented

English | [中文](2026-09-13-adaptive-admission-fail-closed.zh.md)

## Problem

A failed automatic route resolution could retain a saved external model. Unpriced dashboard calls could also display a zero-dollar headline.

## Decision

Prompt admission rejects classifier and resolution errors before enqueueing input. Recovery escalation propagates failures rather than dispatching the prior route. Dashboard totals with unpriced calls and no priced calls display an unknown value. Manual model selection is unchanged.

## Verification

Focused API tests reject classifier and unavailable-adapter failures without calling followup. Dashboard tests assert the unknown headline and absence of a zero-dollar claim. These tests do not prove provider residency or invoice reconciliation; arbitrary configured external primary routes still require a separate policy review.

## Alternatives considered

**Retain the previous route:** this hides the failed selection and may cross the intended execution boundary.

**Invent a tariff:** this hides incomplete accounting instead of resolving it.

## Consequences

Automatic requests can be rejected while a manually selected route remains available. Missing prices stay visible and require verified tariff configuration; this change does not add prices or alter stored usage.
