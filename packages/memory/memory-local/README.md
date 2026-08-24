# @deepseek-ai/dsh-memory-local

English | [中文](README.zh.md)

This package is the local Service Provider for `ctx.memory`. It opens the versioned `memory_local` domain through `ctx.storageDomain`, so the deployment-selected storage backend owns the physical medium and durability behavior.

## Behavior

- Records are keyed by generated `MemoryId` values and carry stable `WorkspaceId` ownership, session provenance, ISO timestamps, and a compare-and-set revision.
- Create, correct, and forget operations are serialized. The durable write lands before the operation resolves.
- Search filters by workspace before ranking. Its first implementation is deterministic, accent-insensitive lexical matching with phrase and query-term coverage scoring.
- Cross-workspace correction and deletion return the same `MEMORY_NOT_FOUND` error as an unknown id, so record existence does not leak between workspaces.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-memory`; this provider registers no tool or prompt section.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Lexical ranking is intentionally small and dependency-free. Embedding retrieval can become another provider or a versioned provider implementation after evaluation proves the need.
- The domain is schema-versioned but has no migration runner yet; a future schema change must ship an explicit migration path.
