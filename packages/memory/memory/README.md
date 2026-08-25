# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

`MemoryRuntime` (`ctx.memory`) is the Service Definition for durable long-term memory. It keeps the product contract independent of Letta, a local JSON medium, or any later vector database.

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-memory` | Service Definition: normalized records, workspace scope, provider selection, revision checks, and errors |
| `@deepseek-ai/dsh-memory-local` | Service Provider: local durable records and lexical retrieval over `ctx.storageDomain` |
| `@deepseek-ai/dsh-tool-memory` | Consumer: explicit model-facing create, search, correct, and forget controls |

## Service API

Every operation carries a stable `WorkspaceId`; raw paths are never ownership keys. `create()` stores normalized content and provenance plus optional zero-to-one importance and confidence signals and an `explicit` or `reviewed` confirmation class. Legacy records may omit those ranking signals. `search()` returns bounded provider-ranked hits, `update()` replaces an exact revision, and `forget()` deletes an exact revision. Corrections and deletion use `{ id, revision }` so stale model context cannot overwrite a newer fact.

Provider selection is execution-time and registration-order independent. An explicit `provider` must be registered and usable. Without one, exactly one usable provider is required; zero or several usable providers fail with a structured `MemoryError` code.

## Model Experience

Indirectly, through a Consumer such as `@deepseek-ai/dsh-tool-memory`. This package contributes no tool, prompt text, or automatic conversation capture.

#### KV Cache effect

No direct invalidation. A Consumer owns any model-visible schema or prompt changes.

## Known Limitations and Deferred Work

- The first contract supports workspace scope only; user-global and organization scopes are deferred until their authority rules are explicit.
- Imported-provider provenance and embeddings are deferred. The normalized API can add them without changing memory ownership.
- The service does not decide what deserves retention. That policy belongs to the Consumer.
