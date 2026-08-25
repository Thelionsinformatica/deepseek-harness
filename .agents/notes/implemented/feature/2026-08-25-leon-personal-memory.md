# Agent Note: Leon personal memory across workspaces

Status: implemented

English | [中文](2026-08-25-leon-personal-memory.zh.md)

## Problem

Leon retained durable facts only inside the current project workspace. That isolation protected projects but forced the user to repeat stable preferences, recurring devices and software, aliases, routines, and non-sensitive operational context whenever work moved to another workspace. Treating those facts as project records would either lose continuity or intentionally leak one project's data into another.

## Decision

Leon has a separate `ctx.personalMemory` service with its own provider registry, `PersonalMemoryOwnerId` scope, lifecycle, operation events, and provider contract. The Web host selects the local provider and stores it in the dedicated `personal_memory_local` domain; workspace memory continues to use `memory_local`. The local adapter reuses the proven serialized revision and compare-and-set engine but never exposes its internal partition key as a workspace.

The Leon preset names one explicit local owner partition. When that partition and service are present, `dsh-tool-memory` adds `personal_memory_remember`, `personal_memory_search`, `personal_memory_update`, and `personal_memory_forget`. First-step personal recall is bounded by the same record and character ceilings as workspace recall, labels every snapshot as untrusted data with no instruction authority, and fails open when optional retrieval is unavailable.

Personal writes require explicit remember intent or a clearly confirmed durable fact. The provider-neutral service rejects credential-like content before provider execution, so a different Consumer cannot bypass the model tool's filter. The shared detector covers common API keys, access tokens, private keys, passwords, JWTs, and cloud credentials without claiming to be a complete data-loss-prevention system.

The anonymous telemetry correlation id remains unrelated to personal ownership. It is neither reused nor promoted into `PersonalMemoryOwnerId`. The shipped single-user label is explicit deployment configuration and does not imply an authenticated account.

## Verification

Runtime tests cover normalization, provider selection, safe event metadata, validation, and rejection before provider writes. Local-provider tests cover restart durability, cross-owner isolation, separate storage domains, revision history, stale revisions, correction, and forgetting. The real agent loop proves that one session can store a personal preference and a session in another registered workspace receives it through bounded automatic recall. A Loader composition test boots the service and provider through the same plugin mechanism used by the Web product.

## Alternatives considered

- **Use one hidden workspace as global memory** — rejected because a synthetic project would obscure the authority boundary, leak workspace concepts into the public API, and let project administration accidentally govern personal facts.
- **Reuse the anonymous telemetry id as owner identity** — rejected because that value is a resettable correlation id, not an authenticated person or an authorization decision.
- **Extend `MemoryScope` into a workspace-or-person union** — rejected because one provider registry and one storage domain would make accidental cross-scope routing easier and complicate rollback. Separate services keep lifecycle and provider selection independent.
- **Adopt Letta as the personal store** — rejected for this increment because the current Letta Agent SDK is a complete stateful-agent runtime rather than a drop-in equivalent of Leon's exact revisioned CRUD contract. The local provider remains deterministic and keyless.
- **Store personal facts automatically from every conversation** — rejected because casual statements, secrets, and corrections need explicit user authority. Automatic recall is enabled; automatic durable writing is not.

## Consequences

Leon can carry explicit personal preferences and recurring local context across projects without weakening workspace isolation or depending on a remote API. Model changes do not erase the records because memory lives in a provider-owned local domain. The additional tool schemas and prompt section are present only when a personal owner is configured.

This increment does not provide authenticated multi-user ownership, encryption at rest, a browser administration screen, semantic personal retrieval, or a general secret detector. Local files inherit the configured storage backend and operating-system protections. A later UI must expose consultation, correction, deletion, disabling, and backup without merging personal and project records.
