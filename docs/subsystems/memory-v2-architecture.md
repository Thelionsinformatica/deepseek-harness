# Memory V2 — Reference architecture

English | [中文](memory-v2-architecture.zh.md)

Objective: improve continuity with safety and control, without changing ownership of Leon's identity or requiring external services.

## 1) Current architecture map (approved)

```text
User
 └─ Prompt
    └─ Preset Leon
       ├─ tool-memory (consumer explícito + recall read-only)
       └─ agentes de execução (DSH agent loop)
    └─ Host
       ├─ ctx.memory (MemoryRuntime)
       ├─ memory-local (provider local por workspace)
       └─ workspaceRegistry
```

Current implementations:

- `ctx.memory`: provider-neutral seam.
- `memory-local`: local provider backed by the storage domain.
- `tool-memory`: explicit tools, optional automatic recall, and opt-in local shadow extraction without durable memory writes.
- `MemoryContextComposer`: final deduplication, scope and sensitive-content recheck, character budget, source labels, and an explicit untrusted-data boundary before automatic recall reaches the model.
- Temporal lineage: schema V2 activation, expiry, `supersedes`, and `supersededBy` metadata with atomically preserved local revision history.
- `ctx.workspaceRegistry`: workspace resolution from `cwd`.

## 2) V2 target architecture

### Required layers

1. **Working Memory**
   - Current session context; it does not persist between sessions.
2. **Persistent Memory**
   - Stable facts, decisions, preferences, and configurations.
3. **Knowledge/RAG Layer**
   - Project and document content used for supplementary retrieval.
4. **Memory Event Journal**
   - Decision trail for creation, updates, forgetting, and correction.

### V2 runtime

- **MemoryCandidateExtractor**
  - Reads a message without storing it yet.
  - Emits a candidate with `category`, `confidence`, `importance`, `scopeCandidate`, and `sensitivity`.
  - Does not change memory; it only produces a trace.
  - Implemented with conservative deterministic patterns for the Leon preset.
- **MemoryPolicyEngine**
  - Applies deterministic rules: absolute block, confirmation, automatic storage, or rejection.
- **ShadowStore**
  - Persists candidates for user review without affecting responses yet.
- **MemoryDecisionQueue**
  - Holds pending candidates and their decision trail.
- **MemoryPolicyVersion**
  - Numeric version used for rollback and historical traces.

### Integration with the current composition

- `tool-memory` remains the consumer of the `ctx.memory` API.
- `MemoryRuntime` remains the provider-neutral contract.
- The current `automaticRecall` becomes the initial read and context-preparation stage in V2, without mutation.
- Recalled values enter one plugin snapshot as quoted JSON data with `instructionAuthority: none`; stored text never becomes a system or developer instruction.
- Active recall resolves the revision valid at query time. Historical revisions require an explicit audit search and never enter the automatic snapshot.

## 3) Evolution points compatible with the current code

- Introduce `MemoryExtractor` and `MemoryPolicyService` as parallel services in the host composition.
- Keep schema V2 temporal lineage optional at the boundary so schema V1 records remain readable without a physical migration.
- Keep the current `local` provider as the default, adding `local-semantic` or future providers only after their benefit is demonstrated.

## 4) Scope restrictions (non-negotiable)

- Personal memory and document RAG must not be merged directly into one state.
- Retrieval must never cross workspace boundaries.
- Automatic write semantics require deterministic policy and, when necessary, user authorization first.
- The memory service must not change Leon's identity, name, or voice.

## 5) Recommended sequence

`baseline → observability → shadow mode → policy → controlled automatic storage → hybrid retrieval → safe context → temporal history → LEON-EVAL → optional provider`
