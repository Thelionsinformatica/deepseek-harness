---
description: "Service Definition for workspace-scoped long-term memory (ctx.memory), for maintainers composing Leon memory providers and consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`MemoryRuntime` (`ctx.memory`) is the Service Definition for durable long-term memory. It keeps the product contract independent of Letta, a local JSON medium, or any later vector database.

## Table of Contents

- [Service API](#service-api)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-memory` | Service Definition: normalized records, workspace scope, provider selection, revision checks, and errors |
| `@deepseek-ai/dsh-memory-local` | Service Provider: local durable records and lexical retrieval over `ctx.storageDomain` |
| `@deepseek-ai/dsh-tool-memory` | Consumer: explicit model-facing create, search, correct, and forget controls |

<a id="service-api"></a>
## Service API

Every operation carries a stable `WorkspaceId`; raw paths are never ownership keys. `create()` stores normalized content and source plus optional zero-to-one importance and confidence signals, an `explicit` or `reviewed` confirmation class, and optional activation or expiry timestamps. Legacy records may omit those fields. `search()` returns bounded provider-ranked hits and requests active records by default; `includeHistory` explicitly asks a provider for inactive revisions as well. The administrative `list()` operation returns a bounded page filtered by lifecycle status and optional text, including temporal history only inside the requested workspace. `update()` corrects an exact revision, and `forget()` deletes an exact revision. Corrections and deletion use `{ id, revision }` so stale model context cannot overwrite a newer fact.

Record schema V2 adds `validFrom`, `validUntil`, `expiresAt`, `supersedes`, and `supersededBy`. The contract still accepts schema V1 records. Preservation and physical layout are provider responsibilities; the shipped local provider preserves revisions atomically instead of silently overwriting them.

`update()` optionally accepts fresh `validation` (`explicit` or `reviewed`) and `confidence` (0–1). These are Host-supplied confirmation metadata, not self-approval fields on model tools. In the local provider, changed content clears omitted confirmation metadata; unchanged content retains omitted metadata. Explicit values apply to the new revision without rewriting temporal history.

Provider selection is execution-time and registration-order independent. An explicit `provider` must be registered and usable. Without one, exactly one usable provider is required; zero or several usable providers fail with a structured `MemoryError` code.

<a id="model-experience"></a>
## Model Experience

Indirectly, through a Consumer such as `@deepseek-ai/dsh-tool-memory`. This package contributes no tool, prompt text, or automatic conversation capture. Administrative listing is a Host/UI capability and does not expand the model-facing tool API.

#### KV Cache effect

No direct invalidation. A Consumer owns any model-visible schema or prompt changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This contract remains workspace-only. Cross-workspace personal facts use the separate [`ctx.personalMemory`](../personal-memory/) service; organization scope remains deferred until its authority rules are explicit.
- Imported-provider source and embeddings are deferred. The normalized API can add them without changing memory ownership.
- Historical search is an explicit audit operation. Automatic recall remains active-only and workspace-scoped.
- The service does not decide what deserves retention. That policy belongs to the Consumer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. The package was ported from the Leon fork onto DeepSeek Harness 0.2.1; the [replatform Agent Note](../../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.md) records the porting approach.

</details>
