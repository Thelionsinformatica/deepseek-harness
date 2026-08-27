# Agent Note: Leon personalization settings

Status: implemented

English | [中文](2026-08-26-leon-personalization-settings.zh.md)

## Problem

Leon had a fixed preset persona and separate memory administration in the Work dashboard, but no single product surface where the user could provide durable custom instructions, choose a response tone, or control local personal-memory behavior. Switching models therefore preserved the preset and memory records but offered no explicit, model-neutral user personalization layer.

## Decision

The `ui-settings-personalization` feature owns a new ordered `settings.section` entry and the `leon-personalization` Host settings namespace. It persists custom instructions, one of five stable response styles, and the preference that governs personal-memory suggestions in tool-assisted chats. Its Host half contributes one order-10 system-prompt section after the core Leon persona, so local and API models receive the same personalization without replacing identity, safety, tool, privacy, approval, or verification policy.

Custom text is bounded to 12,000 characters and strict prompt-variable braces are converted to literal prose before assembly. The response-style selector changes tone only. Tool-assisted memory remains confirmation-gated: enabling suggestions does not grant automatic durable writes, while disabling them tells the agent not to propose or create personal memories unless the user explicitly asks.

The memory controls reuse the existing `personal-memory` settings namespace and runtime watcher instead of creating another store. Bulk deletion uses the existing audited `memoryCandidateReview` Remote, requires a current session and a visible confirmation, deletes every personal-memory status in bounded batches, and never deletes chats, project memory, or project files.

## Verification

Host tests prove schema validation, prompt ordering, live settings adoption, literal-brace safety, confirmation wording, and disposal. Client tests prove instruction saves, style selection, both memory toggles, the destructive confirmation boundary, and the no-session guard. The assembled Web application is covered by the GUI and replay snapshot gates, followed by a live browser inspection of the settings page.

## Alternatives considered

- **Keep personalization only in the fixed Leon preset** — rejected because every user preference would require editing deployment configuration and could diverge between local and API models.
- **Let each model keep its own instructions and response style** — rejected because switching models would change Leon's behavior instead of preserving one model-neutral user preference.
- **Enable automatic personal-memory writes with the suggestion toggle** — rejected because a preference for suggestions must not grant durable-write authority or weaken explicit review.

## Consequences

Leon now has a durable, model-neutral personalization layer similar to the Work experience. Changing from a local model to Gemini or OpenAI no longer changes the user's configured instructions or selected tone, although smaller local models may follow stylistic nuance less reliably. Personal memory remains local, owner-isolated, inspectable, and explicitly controlled.

This increment does not infer a different personality per model, synchronize preferences through a cloud account, or delete workspace/project memories from the Personalization page. Those boundaries are deliberate: personality is a user preference, remote synchronization needs a separate trust model, and project-memory administration remains scoped to its project.
