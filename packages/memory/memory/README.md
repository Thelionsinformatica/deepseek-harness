# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

`MemoryRuntime` (`ctx.memory`) is the Service Definition for durable long-term memory. It keeps the product contract independent of Letta, a local JSON medium, or any later vector database.

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-memory` | Service Definition: normalized records, workspace scope, provider selection, revision checks, and errors |
| `@deepseek-ai/dsh-memory-local` | Service Provider: local durable records and lexical retrieval over `ctx.storageDomain` |
| `@deepseek-ai/dsh-tool-memory` | Consumer: explicit model-facing create, search, correct, and forget controls |

## Service API

Every operation carries a stable `WorkspaceId`; raw paths are never ownership keys. `create()` stores normalized content and provenance plus optional zero-to-one importance and confidence signals, an `explicit` or `reviewed` confirmation class, and optional activation or expiry timestamps. Legacy records may omit those fields. `search()` returns bounded provider-ranked hits and requests active records by default; `includeHistory` explicitly asks a provider for inactive revisions as well. The administrative `list()` operation returns a bounded page filtered by lifecycle status and optional text, including temporal history only inside the requested workspace. `update()` corrects an exact revision, and `forget()` deletes an exact revision. Corrections and deletion use `{ id, revision }` so stale model context cannot overwrite a newer fact.

Record schema V2 adds `validFrom`, `validUntil`, `expiresAt`, `supersedes`, and `supersededBy`. The contract still accepts schema V1 records. Preservation and physical layout are provider responsibilities; the shipped local provider preserves revisions atomically instead of silently overwriting them.

Provider selection is execution-time and registration-order independent. An explicit `provider` must be registered and usable. Without one, exactly one usable provider is required; zero or several usable providers fail with a structured `MemoryError` code.

## Model Experience

Indirectly, through a Consumer such as `@deepseek-ai/dsh-tool-memory`. This package contributes no tool, prompt text, or automatic conversation capture. Administrative listing is a Host/UI capability and does not expand the model-facing tool API.

#### KV Cache effect

No direct invalidation. A Consumer owns any model-visible schema or prompt changes.

## Known Limitations and Deferred Work

- This contract remains workspace-only. Cross-workspace personal facts use the separate [`ctx.personalMemory`](../personal-memory/) service; organization scope remains deferred until its authority rules are explicit.
- Imported-provider provenance and embeddings are deferred. The normalized API can add them without changing memory ownership.
- Historical search is an explicit audit operation. Automatic recall remains active-only and workspace-scoped.
- The service does not decide what deserves retention. That policy belongs to the Consumer.
