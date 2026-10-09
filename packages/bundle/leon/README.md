---
description: "Leon's profile bundle: memory services, Leon guards, and the leon agent preset over the dsh Web application, for maintainers deploying Leon."
kind: "package-bundle"
---

# @deepseek-ai/dsh-leon

English | [中文](README.zh.md)

## Summary

`dsh-leon` turns the dsh Web application into Leon, The Lions Informática's local assistant in Brazilian Portuguese. Listed after `dsh-base` and `dsh-web-app` in a profile, it mounts workspace and personal memory, the candidate review and procedure-learning services, and the failure-recovery guard on the host, keeps the base session index on disk, and adds the `leon` agent preset as the default. The preset composes the Leon persona, memory tools, the documentary knowledge base with its target guard, the completion-claim policy, and the Leon skills. Session search comes from the optional `dsh-experimental-session-search` bundle; web tools and MCP are not composed yet.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

List the bundle after the Web layers in the profile's `package.json`:

```json
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-leon", "@deepseek-ai/dsh-experimental-session-search"] } } }
```

The last bundle provides the `session_search` tool the persona relies on; Leon itself depends on no experimental package.

New sessions then start with the `leon` preset. The profile's own `cordis.patch.yml` still applies after this bundle, so a deployment enables semantic memory recall there once a loopback embeddings endpoint runs:

```yaml
- id: memory-local
  config:
    semanticSearch: { enabled: true, api: openai-compatible, baseUrl: http://127.0.0.1:8099, model: nomic-embed-text, dimensions: 768 }
```

<a id="understand-the-implementation"></a>
## Understand the implementation

The bundle has two patch files. `cordis.patch.yml` overrides `session-query-sqlite` to a durable index opened on first search, sets the agent preset registry default to `leon`, and inserts the host rows. `presets/leon.patch.yml` inserts one `@deepseek-ai/dsh-agent-preset` declaration whose plugins mount per agent. The `skills/` directory ships with the package and is added to the preset's skill roots through `skill-filesystem`. The knowledge-base tool runs the helper shipped by `dsh-tool-knowledge-base`; the copy inside the `leon-knowledge-base` skill serves the skill's maintenance commands and must stay byte-identical, which the package tests enforce.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the mounted packages: the bundle is a patch-list carrier, and the Leon persona reaches the model through `dsh-persona`.

#### KV Cache effect

The bundle adds nothing of its own to the request prefix; the composed plugins own their sections and tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No web tools yet** — `web_search` and `web_fetch` stay out of the preset until Leon's per-call egress approval is ported, so the preset never sends queries out without consent.
- **No MCP desktop automation yet** — the Cua driver bridge waits for executor-side approval and a tool allowlist.
- **Not ported yet** — the read-only audit subagent, the goal completion auditor, and Leon's client pages.
- **Single local owner** — memory owner ids are fixed for a single-user Windows deployment; multi-user hosts must override them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. The bundle replaces the fork's `apps/cli/config/agent-presets/leon` directory, because 0.2.1 presets are plugin rows in a bundle; the [replatform Agent Note](../../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.md) records the migration.

</details>
