# Agent Note: Scoped tool description compaction

Status: implemented

English | [中文](2026-08-22-scoped-tool-description-compaction.zh.md)

## Problem

Local models spend first-token latency ingesting every visible tool's description and nested parameter descriptions. A capable preset such as Leon needs the complete callable surface, but repeating verbose prose in every request can dominate its static context. Editing the registered definitions would also degrade catalogs, validation diagnostics, and other agents that can afford the full text.

## Decision

`ToolRuntime.compactDescriptions(maxLength)` declares an inheritable, agent-scoped character cap for model-facing descriptions. It normalizes whitespace and truncates tool and nested parameter descriptions with an ellipsis. Native schemas and generated Code Mode SDKs use the compact projection; `get()`, `schemas()`, validation, presentation callbacks, and execution retain the complete registered definitions.

The nearest scope declaration wins and disposal restores the inherited value. Global calls, non-integer limits, values below three, and duplicate declarations in one scope fail explicitly. `dsh-agent-tool-presentation` exposes the declaration as optional `descriptionMaxLength` so a preset owns the trade-off without changing the deployment default.

Leon uses native presentation with a 120-character description cap, an 8 KiB workspace-instruction budget, and 120-character skill catalog summaries. Its real Web composition limits static system sections to 8,000 bytes, tool schemas to 18,000 bytes, and their combined serialized size to 25,000 bytes.

## Verification

Scoped registry tests cover ancestor inheritance, nearer overrides, disposal, recursive parameter-description compaction, invalid declarations, duplicate declarations, and unchanged registry definitions. The presentation-row snapshot pins its configuration and model-facing output. The shipped Web composition test boots the real Leon preset and measures the assembled static context; the tool-schema portion is 16,988 bytes instead of the unbounded 28,971-byte projection in the recorded implementation run.

## Alternatives considered

**Remove tools from Leon.** Rejected because it reduces capability and makes the local model behave differently from the hybrid agent the product promises.

**Edit every tool's canonical description.** Rejected because one local preset's latency budget must not weaken generated catalogs, diagnostics, or other presets.

**Use Code Mode solely to reduce schemas.** Rejected because the generated SDK plus its system section measured larger than Leon's native static context and would change how the local model invokes tools.

**Compact through a prompt-assembly event listener.** Rejected because a listener mounted in a preset's standing scope does not project through the registry's inherited scope chain. The presentation policy belongs beside `presentAs()` in `ToolRuntime`.

## Consequences

Leon sends substantially less fixed text to a local model while preserving its tools and provider routing. Truncated descriptions can omit secondary guidance after the limit, so the preset keeps a moderate cap and retains complete definitions for inspection. Stable scope composition preserves KV-cache prefixes; changing the cap changes the model-facing prefix.
