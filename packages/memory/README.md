---
description: "Package map for Leon's workspace and personal memory: service definitions, local providers, continuity snapshots, and the model-facing tools, for users and maintainers composing Leon memory."
kind: "package-group"
---

# memory/ — Leon long-term memory

English | [中文](README.zh.md)

## Summary

The `memory/` group gives Leon durable project facts and separately scoped personal facts without tying the product to one memory engine. Workspace memory and personal memory each have a provider-neutral service definition and a local provider in separate storage domains. `tool-memory` is the model-facing consumer for both: explicit remember, search, correct, and forget tools, bounded automatic recall, a human-reviewed candidate queue, and reviewed procedure learning. None of these packages is part of the `dsh` base bundle; a Leon composition mounts them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | What it provides |
|---|---|
| [`memory/`](memory/README.md) | `ctx.memory`: workspace-scoped records, exact-revision correction, provider selection |
| [`memory-local/`](memory-local/README.md) | Local `ctx.memory` provider with temporal revisions, lexical and optional loopback semantic retrieval |
| [`memory-continuity/`](memory-continuity/README.md) | Checksummed snapshots and idempotent restore of local memory records |
| [`personal-memory/`](personal-memory/README.md) | `ctx.personalMemory`: owner-scoped personal facts with a live enablement preference |
| [`personal-memory-local/`](personal-memory-local/README.md) | Local `ctx.personalMemory` provider in its own storage domain |
| [`tool-memory/`](tool-memory/README.md) | Model tools, automatic recall, candidate review, administration, and procedure learning |

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory subsystem reference](../../docs/subsystems/memory.md) — ownership, isolation, record vocabulary, and the generated service API.
- [Leon replatform Agent Note](../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.md) — how these packages moved onto DeepSeek Harness 0.2.1.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
