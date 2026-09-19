# @deepseek-ai/dsh-personal-memory-local

English | [中文](README.zh.md)

This package is the local provider for `ctx.personalMemory`. It opens the versioned `personal_memory_local` storage domain, physically separate from workspace memory's `memory_local` domain, and adapts the proven local revision engine without exposing its internal partition key.

## Behavior

- Each local owner maps to one internal partition inside the dedicated personal-memory domain. Public records return only `PersonalMemoryScope`; synthetic workspace identifiers never cross the provider boundary.
- Create, correct, and forget operations remain serialized. `temporal-v2` preserves prior revisions atomically and requires compare-and-set references.
- Search and list never return another owner partition. Cross-owner correction and deletion become `PERSONAL_MEMORY_NOT_FOUND`, hiding whether the id exists elsewhere.
- The provider uses deterministic case- and accent-insensitive lexical retrieval and survives process restart through the selected `ctx.storageDomain` backend.

## Configuration

`historyMode` defaults to `temporal-v2`. `v1` is an emergency rollback to in-place correction; it does not merge the personal and workspace domains.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-memory`; this provider adds no schema or prompt text.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Semantic retrieval is not enabled for personal memory in this increment; deterministic lexical retrieval is the baseline.
- Encryption at rest depends on a future encrypted storage backend or operating-system volume protection.
- Deleting the configured storage directory deletes personal memory; backup and restore must include the `personal_memory_local` domain.
