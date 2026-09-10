# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

The **Plugin Center** tab for Web Settings. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns its navigation entry and tab chrome. It performs no Remote read during plugin activation. Selecting the tab mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

The tab renders a searchable two-column catalog of compact disclosure cards. A card shows a short module name, effective status, Fiber status when enabled, safe category and summary, plus its management classification: `live-toggle`, `restart-required`, or `protected`. Expanded details show the Loader entry id, purpose, capabilities, effective status, runtime state, and the non-secret management reason. Search also matches the summary and capabilities. It never renders raw configuration, source paths, credentials, cookies, or tokens.

Only a Host-returned `live-toggle` card displays an action. The action calls `setEnabled` for that exact entry and replaces local state only with the Host response; it is disabled while the request is in flight and a failure shows generic UI copy rather than transport details. Restart-required and protected entries have no mutation control. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package visualizes a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Runtime control is intentionally narrow** — the interface cannot persist a choice, edit configuration, add or remove entries, or offer a switch for any Host classification other than `live-toggle`.
- **Metadata is diagnostic, not provenance** — category, capability, and summary labels are safe operational descriptions, not a claim about the original bundle or configuration source.
