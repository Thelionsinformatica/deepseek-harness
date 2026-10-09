# @deepseek-ai/dsh-client-ui-work-dashboard

English | [中文](README.zh.md)

This package fills the optional root-scoped `conversation.hero.dashboard` seat with the Leon Work overview on blank sessions. It derives project count, running work, pending interaction, completed work, and the three most recent conversations from the existing Workspace and Session projections. The dashboard does not synthesize provider, GPU, or API health that the browser cannot authoritatively observe.

The package owns only product presentation and navigation. `Nova tarefa` delegates to the Workspace runtime, recent rows delegate to the Session runtime, and the conversation package keeps ownership of the resident composer and the active-task surface. A session-header `Revisar memória` action opens four views: a read-only memory and skills overview, workspace-isolated shadow suggestions, workspace saved-memory administration, and a separately owner-isolated personal-memory panel. Every addition, correction, deletion, or enablement change is visibly confirmed; disabling personal memory leaves inspection and deletion available. The Host remains the sole owner of authorization, feature flags, settings persistence, storage, redaction, audit, and read-only rollback. Brazilian Portuguese is product-authored beside complete English and Simplified Chinese dictionaries. Removing this package from the Web composition restores the ordinary dashboard-free Hero and removes the review control without changing any memory domain.

API costs are estimates, not invoices. Unpriced calls produce a partial-estimate warning; when no call has a price, the card displays an unknown cost instead of a zero-dollar total. Metric cards wrap their labels and details rather than truncating billing caveats.

The personal panel distinguishes pending and confirmed facts, and identifies confirmed profile selections. A human can reconfirm unchanged text or explicitly include or remove a fact from the bounded, query-independent profile. Each action displays the exact text, requires confirmation, and submits the current revision through the Host; it never silently changes a record while opening or inspecting the panel. Redacted, disabled, and read-only records cannot be confirmed or selected. Model-proposed facts stay outside automatic recall until confirmed; existing stored confirmation metadata is not migrated.

The personal panel includes an optional Getting to know you interview. Name, work, communication, goals, and confirmation preferences remain browser-component drafts until individually reviewed and saved through the existing confirmed personal-memory operation. Questions can be skipped; closing the interview discards unsaved drafts. Disabled or read-only memory prevents saving. Preferences never grant permissions. The interview does not invoke a model; approved memories can later enter model context according to the existing recall and provider configuration. Spontaneous chat interviews are not implemented here.

The read-only Overview tab loads project memories, personal memories, and the session-scoped skill inspection only when opened or manually refreshed. An agent profile shows the effective preset and source-specific record counts, including partial and unavailable states. The expandable graph shows up to twelve selectable records per group with zoom controls; a list view and selected-record details expose the returned records without inventing semantic connections. Personal-memory enablement, catalog completeness, model visibility, and inspection time remain distinct facts. Execution authorization is explicitly unevaluated: opening the catalog runs no guards or approval requests, and a visible skill may still be denied when called. Skill registration never claims a passed operational test. Preset or session changes discard the previous inspection, and source failures remain visible without hiding successful sources. Opening this view does not enable memory or send data to a model.

Latest record changes lists each returned memory revision's current update timestamp. A calendar highlights days represented by these timestamps in their latest month; it is not an audit trail, historical diff, count of every edit, or background graph-construction activity. The view reads at most one hundred project rows across all statuses and one hundred active personal rows; pagination and incomplete catalogs are labeled as a partial view. It does not combine workspaces, infer links from memory text, or persist another graph database.

The Overview labels workspace and personal graph health separately: pending, computed, empty, stale, failed, or unavailable. Only a computed snapshot draws similarity edges, matched by memory id and revision. Failure details come from a sanitized code allowlist; backend messages are never rendered. Position groups records without implying relationships; no decorative edges appear when the graph is unavailable.

## Model Experience

None, as the dashboard reads browser projections and invokes navigation or local review actions without adding its copy, candidates, or state to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Runtime health is explanatory rather than live** — model, GPU, Ollama, and cloud-provider health need an authoritative client projection before the dashboard can present status without guessing. The active model remains disclosed by the existing composer chip.
- **Recent work is intentionally compact** — the first version shows at most three nonblank, nonarchived, ordinary sessions. Deliverables, scheduled work, global memory scopes, and permission audit cards remain separate milestones.
