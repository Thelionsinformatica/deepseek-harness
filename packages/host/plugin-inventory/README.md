# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection and narrowly controlled runtime switch for the current Cordis Loader tree. `PluginInventoryGateway` registers `pluginInventory` and publishes generated direct Remotes: `pluginInventory/list` returns the present inventory, and `pluginInventory/setEnabled` changes one deployment-audited optional entry in the current process.

Every list call reads `ctx.loader.entries()` directly, skips structural group rows, and preserves Loader order. Each returned entry includes its Loader id, safe module identity, effective enablement, root Fiber phase, and safe inferred presentation metadata: category, short summary, capabilities, activation mode, and activation reason. The projection never serializes raw Loader configuration, provenance, source paths, credentials, cookies, or tokens. A phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when no root Fiber is live.

`liveToggleEntries` is a deployment-owned allow-list of stable `Entry.options.id` and public module-identity pairs; it defaults to no live controls. Pairing both values prevents an identically named entry elsewhere in the Loader tree from inheriting a grant. `setEnabled` requires an exact listed pair, classifies structural groups, local/URL-shaped identities, and protected session, security, transport, and core modules before the allow-list, and calls the selected entry's `Entry.update()` directly. It intentionally does not call `ctx.loader.update()`: the resulting enablement change is process-local, does not write profile, bundle, include-tree, or user-patch configuration, and resets at restart. All other entries stay visible for diagnosis as `restart-required`; protected entries are explicitly marked `protected`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation. Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

## Model Experience

None, as this Host-only inventory service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time inventory** — the list has no durable failure history or subscription; a missing root Fiber is `null`, regardless of why no live root exists.
- **Runtime-only toggle** — even an audited optional toggle is lost on restart and cannot edit, add, remove, or configure a plugin.
- **No provenance model** — the service does not identify the bundle, profile, or override that introduced an entry; an operator must use the owning deployment configuration for reviewed persistent changes.
