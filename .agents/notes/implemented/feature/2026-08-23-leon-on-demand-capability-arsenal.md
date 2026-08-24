# Agent Note: Leon loads capable tools without mode switching

Status: implemented

English | [中文](2026-08-23-leon-on-demand-capability-arsenal.zh.md)

## Problem

Leon already had a broad coding-agent toolset, but important Work-style capabilities were either disconnected from the Web composition or hidden behind unrelated presets. Browser operation had no maintained runtime, reminder tools were present in the repository but not mounted, and adding a large MCP browser server would permanently increase every local-model request even when no browser was needed.

## Decision

Leon remains one assistant and keeps its existing native tools. Specialized operating guidance is published through the existing scoped skill catalog and loaded only when a request matches it. The shipped preset now includes `leon-browser`, `leon-project-engineer`, and `leon-windows`.

The Web bundle pins `@playwright/cli`, publishes its exact executable entry and the current Node executable through trusted managed shell variables, and lets `leon-browser` open a visible, persistent, Leon-owned Chrome session. The skill requires state inspection after each action and an explicit approval pause before consequential external submission.

The Web host also mounts time context and Schedule before future browser sessions are created. New root agents receive durable Session-scoped reminder tools, and the Leon persona must use them instead of promising to remember in prose.

## Alternatives considered

**Expose every Playwright MCP tool permanently.** Rejected because dozens of dynamic schemas and large accessibility responses would burden the small local models on unrelated turns. The pinned CLI plus an on-demand skill preserves persistent browser state with a smaller steady-state prompt.

**Put browser and Windows access in separate agent presets.** Rejected because the product direction is one Leon that chooses capabilities automatically; switching personas would fragment memory and make the user choose implementation details.

**Claim complete Windows GUI control through PowerShell.** Rejected because PowerShell can operate the system and launch applications but does not prove arbitrary desktop clicks or visual state. The Windows skill states that boundary explicitly.

**Leave reminders as an example overlay.** Rejected because reminder behavior is a normal assistant capability and the existing implementation already owns durability, time-zone interpretation, and lifecycle boundaries.

## Consequences

Leon can search and read the web, open and control a visible browser, operate Windows through its existing approved shell boundary, and create/list/delete reminders without a preset change. Skill bodies are paid only when loaded. Browser authentication remains isolated from the user's personal browser unless the user logs into the Leon-owned window, and high-impact browser actions still require explicit confirmation.

The Playwright CLI is an installed application dependency and must remain pinned and covered by a real headed-browser smoke test on Windows. Reminders remain Session-local: they do not wake a stopped host or send an external notification. Pixel-level automation of arbitrary desktop applications and user-configurable MCP connectors remain separate future capabilities.
