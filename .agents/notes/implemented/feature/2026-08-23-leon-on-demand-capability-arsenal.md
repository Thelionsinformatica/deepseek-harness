# Agent Note: Leon loads capable tools without mode switching

Status: implemented

English | [中文](2026-08-23-leon-on-demand-capability-arsenal.zh.md)

## Problem

Leon already had a broad coding-agent toolset, but important Work-style capabilities were either disconnected from the Web composition or hidden behind unrelated presets. Browser operation had no maintained runtime, reminder tools were present in the repository but not mounted, and adding a large MCP browser server would permanently increase every local-model request even when no browser was needed.

## Decision

Leon remains one assistant and keeps its existing native tools. Specialized operating guidance is published through the existing scoped skill catalog and loaded only when a request matches it. The shipped preset now includes `leon-browser`, `leon-project-engineer`, and `leon-windows`.

The Web bundle pins `@playwright/cli`, publishes its exact executable entry and the current Node executable through trusted managed shell variables, and lets `leon-browser` open a visible, persistent, Leon-owned Chrome session. The skill requires state inspection after each action and an explicit approval pause before consequential external submission.

For an explicit request about “this page” or the open browser, `leon-browser` runs its bundled `scripts/context.mjs` helper before asking for a URL. The helper queries only the fixed `leon` Playwright session, returns bounded active-tab metadata, tab inventory, warning/error summary, and accessibility snapshot, then retains the last result under `DSH_HOME/browser-context/` for unchanged follow-ups. It rejects unsafe session names, strips credential-shaped environment variables from the Playwright child, and never reads cookies, browser storage, request headers, request bodies, or screenshots. A page-changing action invalidates reuse operationally: the skill requires a fresh inspection after navigation, reload, tab selection, or interaction.

For an explicit request about a native Windows application, `leon-windows` can now run its bundled `scripts/uia.ps1` connector. The connector lists top-level windows, inspects the focused or selected window through Windows UI Automation, and returns a depth- and node-bounded accessibility tree without reading control values. Mutations are denied unless the request repeats the exact inspected `windowId` and process name as an allowlist and resolves one unique accessible control by automation ID or exact name/type. Invoke, value, selection, and explicit new-file screenshot operations append a local JSONL audit event under `DSH_HOME/windows-uia/`; entered values are never logged, password controls are refused, and the connector does not inject global keys, use screen coordinates, overwrite screenshots, or elevate privileges.

The Web host also mounts time context and Schedule before future browser sessions are created. New root agents receive durable Session-scoped reminder tools, and the Leon persona must use them instead of promising to remember in prose.

## Alternatives considered

**Expose every Playwright MCP tool permanently.** Rejected because dozens of dynamic schemas and large accessibility responses would burden the small local models on unrelated turns. The pinned CLI plus an on-demand skill preserves persistent browser state with a smaller steady-state prompt.

**Attach the active page to every model request.** Rejected because unrelated prompts would transmit private page content and spend context without user intent. The explicit browser request authorizes one bounded inspection; unchanged follow-ups may reuse the local cache.

**Use coordinate-based desktop automation as the default.** Rejected because pixels and coordinates do not prove which control receives an action and drift across DPI, layout, and window changes. The UI Automation connector requires a semantic, unique target and fails closed when an application does not expose accessibility controls.

**Capture the desktop continuously for visual context.** Rejected because it would collect unrelated private windows without task-specific intent. Screenshots are explicit, scoped to one allowed window, stored only at a new absolute PNG path chosen for the task, and never attached automatically.

**Put browser and Windows access in separate agent presets.** Rejected because the product direction is one Leon that chooses capabilities automatically; switching personas would fragment memory and make the user choose implementation details.

**Claim complete Windows GUI control through PowerShell.** Rejected because PowerShell can operate the system and launch applications but does not prove arbitrary desktop clicks or visual state. The Windows skill states that boundary explicitly.

**Leave reminders as an example overlay.** Rejected because reminder behavior is a normal assistant capability and the existing implementation already owns durability, time-zone interpretation, and lifecycle boundaries.

## Consequences

Leon can search and read the web, open and control a visible browser, identify the active Leon-owned tab without requesting its URL, operate Windows through its existing approved shell boundary, and create/list/delete reminders without a preset change. Skill bodies are paid only when loaded. Browser authentication remains isolated from the user's personal browser unless the user logs into the Leon-owned window, cached accessibility context remains local until an explicit browser task invokes the helper, and high-impact browser actions still require explicit confirmation.

The Playwright CLI is an installed application dependency and must remain pinned and covered by a real headed-browser smoke test on Windows. Windows UI Automation is now read-only by default, actions stay scoped to one explicitly allowed process/window, and unsupported pixel-only applications remain visible limitations rather than implicit permission for coordinate clicks. Reminders remain Session-local: they do not wake a stopped host or send an external notification. [Personal memory](2026-08-25-leon-personal-memory.md) uses a separate local provider, scope, and lifecycle so project memory cannot leak across workspaces. User-configurable external connectors remain a later, independently revocable capability.
