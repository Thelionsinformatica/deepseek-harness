# @deepseek-ai/dsh-client-ui-skill

English | [中文](README.zh.md)

Skill invocation source, browser half: registers the `/`-trigger `skill` source into `ctx.inputTriggers`. Ordinary-session candidates come from the `skill.list` RPC addressed by the per-call `ClientSessionContext` projection's `{sessionId}`, with the host resolving `cwd` from the session header. The host serves every user-invocable skill; a `modelInvocable: false` entry (a `disable-model-invocation` skill, whose only entry point is this path) wears the user-only marker as a description prefix in the active language. Catalog-addressed continuable children resolve no skill candidates locally because the existing skill RPC requires an attached session; viewing their persisted history must not activate them. Catalogs cache per ordinary session with a single-flight fetch; the scope-birth `warm` hook prewarms the session's entry, the forwarded `agent-preset/selected` owner event drops that one session's entry (the catalog belongs to the preset, and a blank session may switch after the warm), and `connection/reset` clears everything. Results filter by `startsWith(query)`.

A pick lands the literal `/name ` text and the prompt ships the same literal ([slash-pipeline Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)) — this source implements no adjudication hooks and no reference codec. Determinism lives host-side: the pre-step gesture boundary (`dsh-tool-skill`) recognizes whitespace-bounded `/name` tokens naming user-invocable skills anywhere in a user message and injects the rendered `<skill_content>` for every entry point, so a menu pick, a hand-typed token, and a TUI/ACP prompt all load the skill the same way. A name shared with a host command still resolves to the command: adjudication claims the line client-side before it ever becomes a prompt — deliberate precedence, matching peer products. The list RPC rides the plugin's root-context connection captured at registration — the source never reads services off a per-call argument; draft chip visuals derive from the `lexicon` scan.

A failed `skill.list` throws from `candidates`, which the slash shell logs and folds into a silent menu-group drop — the menu shows only pending/ready states.

The `/client` exports are the plugin body (`apply`/`inject`) only; the source object is internal to the registration effect.

## Installed skill settings

The `Skills` section registers in `ui-settings` through the existing `settings.section` slot. It lists local skills, including disabled entries, from `skills.catalog`. The profile picker reads `agentPresets.list`; choosing a profile only changes what this page inspects, not the default profile or a conversation's profile. The optional workspace picker uses registered workspace IDs from `useWorkspaces`. Without a workspace, the catalog covers profile and user roots; with one, the Host resolves its directory and includes project skills. The page never accepts a filesystem path or installs skills.

Each toggle saves the selected profile's disabled skill names through `settings.mutate` in the `agent-presets` namespace, with the catalog's `revision` as `expectedRevision`. Preferences apply by name across that profile's workspaces. Writes preserve disabled names absent from the current catalog, wait for the RPC result, and re-read the catalog rather than showing an optimistic success. Refused or uncertain writes are not retried automatically. The UI distinguishes incomplete catalogs, confirmed empty catalogs, read-only settings, loading, and errors. A single pending write locks the controls; superseded reads are aborted and cannot replace newer results, and plugin disposal awaits pending operations without publishing late state.

Enabling a skill does not override its model/user invocation restrictions. Changes affect subsequent catalog reads and skill loads; they do not remove instructions already loaded into a conversation. A forwarded `settings/document-updated` event for `agent-presets` clears all slash catalog caches and refreshes the Settings catalog if it has been opened. Reconnect does the same. Copy is available in Brazilian Portuguese, English, and Chinese.

## Skill tool row

The browser plugin also registers the `skill` wire name in `ui-tool`'s keyed `tool.call.toolview` slot. A collapsed row renders the 14-pixel skill document-and-sparkle glyph, `Skill` title, separator, and requested skill name with the same neutral hierarchy as the Bash row; running calls carry the transcript shimmer, failures replace the name with the first error line, and interrupted calls use the warning state. A settled row expands as one whole-row disclosure into a bounded `Instructions` card containing the exact durable tool output, with the standard trajectory `Inspect` affordance when available. The row derives its name, lifecycle, and body only from the frozen call/result slice supplied by `ui-tool`, never from the current catalog, so replay remains stable when installed skills or their descriptions change.

## Model Experience

### User-explicit skill invocation

#### What the model sees

The user's message reaches the model verbatim, `/name` literal included. The host's pre-step boundary (`dsh-tool-skill`) then appends the canonical `<skill_content>` block — the same `renderSkillContent` output the `skill` tool returns — as injected instructions context at the end of that step's injections, closest to the model's answer. Loading is deterministic: the model receives the full body without being asked to call the `skill` tool, and the catalog tells it not to re-load an inline-injected skill.

#### Token effect

One invocation adds the rendered skill body to that turn as injected context — the same cost as the model loading the skill through the tool, paid unconditionally instead of at the model's discretion. Menu browsing, candidate fetches, and Settings catalog reads or preference writes make no model calls and add zero model tokens. Availability changes can affect subsequent Host skill assembly, not already loaded instructions.

#### KV Cache effect

Append-only: the injected message lands after the reusable history prefix. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **Result-only history pages use the generic row** — keyed dispatch needs the paired call in the runtime window; pagination that leaves the call outside has no tool identity. This client presentation feature does not extend the history wire contract to recover it.
- **Text is the truth** — the reference is plain draft text; a hand-typed identical token is the same reference, and the host gesture boundary judges the sent text, not the menu interaction. Chip visuals derive from the lexicon scan; no occurrence identity, position tracking, or structured reference payload on the prompt wire (both are ledger items).
- **A menu opened before the prewarm settles** shows no skill candidates for that keystroke; the next keystroke re-polls the settled cache.
