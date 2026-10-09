# Agent Note: Creator completion review and explicit new-session defaults

Status: implemented

English | [中文](2026-09-25-creator-completion-review.zh.md)

## Problem

Creator sessions could complete a goal without the task evidence and independent review required by Leon. The preset roster's "In use" badge also conflated the default for new sessions with the preset of an existing conversation.

## Decision

The shipped `cordis` composition enables Leon's completed-task and independent `spawn` review configuration with the same audit limits. The existing host auxiliary review route remains authoritative. The reviewer driver adds private scoped evidence and structured-output tools; those names must not be added to the global `completionAuditorTools` restriction. Host guards deny coordinator capabilities in the reviewer.

Creator also adopts Leon's Windows process-termination and managed-server checks while preserving ordinary authoring tools and persisted sandbox overrides. The preset roster badge names its actual meaning in English, Portuguese, and Chinese: default for new sessions. The current-session header remains the source for the active preset.

This composition decision supplements the [goal-tool authority decision](../feature/2026-07-19-model-facing-goal-tools.md); it does not replace that mechanism or the [Creator entry guidance](../feature/2026-08-10-creator-guidance-introduce-cue.md).

## Alternatives considered

Prompt-only review cannot prevent the completion mutation. Replacing persisted full-access selections would silently change user policy. A new reviewer provider or hard-coded model would duplicate the existing host routing and risk divergence. All three alternatives are rejected.

## Consequences

Goals remain active if evidence is missing or review rejects, returns no structured verdict, or cannot run. Existing models, credentials, limits, and saved permission choices remain unchanged. Creator retains shell-equivalent composition authority; the added checks are not containment against arbitrary authored code. Already mounted agents need remounting to adopt composition edits.

## Testing

Keyless Web-composition tests load the shipped Creator preset and use the real isolated `spawn` reviewer with a scripted adapter. They pin missing and incomplete task rejection, successful structured approval, rejection, unstructured-output refusal, reviewer tool isolation, process-policy denials, preserved full-access state, and retained coding tools. Component tests pin the Portuguese badge and accessible name without changing selection behavior. External inference and live deployment restart are outside these tests.
