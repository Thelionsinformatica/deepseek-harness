# Memory

English | [中文](memory.zh.md)

The memory subsystem gives Leon durable, workspace-scoped facts without coupling the product to one memory engine. It is split into a Service Definition ([dsh-memory](../../packages/memory/memory), `ctx.memory`), a first local Service Provider ([dsh-memory-local](../../packages/memory/memory-local), provider id `local`), and a model-facing Consumer ([dsh-tool-memory](../../packages/memory/tool-memory)). A future Letta adapter can implement the same provider contract without changing tool names, workspace ownership, or the records the rest of Leon receives.

Design records: [provider-neutral workspace memory](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.md) and [controlled automatic recall](../../.agents/notes/implemented/architecture/2026-08-22-controlled-automatic-memory-recall.md).

## Ownership and isolation

Every operation carries a `MemoryScope` containing a stable `WorkspaceId`. Raw directory paths are never ownership keys. The local provider includes that scope in every lookup and deliberately returns `MEMORY_NOT_FOUND` for a record owned by another workspace, so neither search results nor error details reveal cross-workspace data.

`MemorySource` records the session that explicitly created a fact. This is provenance, not ownership: the workspace remains the sole isolation boundary in the first contract.

## Record and operation vocabulary

| Type | Meaning |
|---|---|
| `MemoryId` | stable branded identity independent of content and provider |
| `MemoryRecord` | normalized content, scope, session provenance, timestamps, and revision |
| `MemoryRef` | exact `{ id, revision }` compare-and-set reference |
| `MemoryCreateRequest` | workspace scope, content, and source session |
| `MemorySearchRequest` / `MemorySearchHit` | bounded query and provider-ranked result |
| `MemoryUpdateRequest` | replacement content for one exact revision |
| `MemoryForgetRequest` | deletion of one exact revision |
| `MemoryProvider` | create/search/update/forget backend contract |

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

Corrections and deletion require the current revision. A successful correction increments it; a stale reference fails with `MEMORY_REVISION_CONFLICT` instead of overwriting newer knowledge. The runtime trims and bounds content and queries before they reach a provider, caps search results, and forwards cancellation.

## Provider selection and local durability

Selection happens at execution time and never depends on plugin registration order. An explicitly configured provider must be registered and locally available. Without an explicit id, exactly one usable provider is required; zero or multiple candidates produce structured `MemoryError` codes.

The `local` provider stores records through the versioned `memory_local` storage domain. It serializes mutations, preserves committed state when a write fails, performs deterministic case- and accent-insensitive lexical search, and survives process restart. It does not provide semantic embeddings; a later vector or Letta provider can add richer retrieval behind the same service contract.

## Model policy

`dsh-tool-memory` contributes four tools: `memory_remember`, `memory_search`, `memory_update`, and `memory_forget`. It resolves the active session directory through `ctx.workspaceRegistry`, so the model never supplies a workspace id or raw path. Its prompt policy tells Leon to search before claiming that durable context is unknown, retain only explicit stable facts, and never store passwords, API keys, tokens, private keys, or other secrets. Conversation text is not captured automatically.

The Leon preset enables bounded automatic recall on the first model request of each turn. The query comes only from human-authored text, retrieval remains inside the current workspace, and at most four safe hits in a 4,000-character snapshot are prepended as untrusted data. The model-facing boundary rejects credential-like writes and filters credential-like search hits. Provider failures fail open for recall—the turn continues without the optional snapshot—while explicit mutation failures remain visible tool errors. No path performs an automatic memory write.

`tool-memory` emits deterministic policy metadata for each `memory/candidate` event and each persisted shadow candidate row: `policyVersion`, `policyDecision`, and `policyReason`. Candidate telemetry carries only the transient query length, never its text, including when policy blocks the query or requires confirmation. This supports replay and review workflows without changing recall content behavior yet.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime"></a>

### `ctx.memory` — `MemoryRuntime`

Durable memory service and registration-order-independent provider selector.

```ts cordis-catalog
/**
 * Register one provider for the lifetime chosen by the caller.
 * @param provider - Provider implementation keyed by its stable id.
 * @returns disposer that removes this exact registration.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Create one normalized durable memory through the selected provider.
 * @param request - Workspace scope, durable content, and session provenance.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns the created normalized record after durability.
 */
async create(request: MemoryCreateRequest, signal?: AbortSignal): Promise<MemoryRecord>

/**
 * Search only inside the request's workspace scope.
 * @param request - Workspace scope, query, and bounded result limit.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns ranked hits capped to the requested limit.
 */
async search(request: MemorySearchRequest, signal?: AbortSignal): Promise<readonly MemorySearchHit[]>

/**
 * Correct one exact memory revision through the selected provider.
 * @param request - Workspace scope, compare-and-set reference, and replacement content.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns the corrected record with its incremented revision.
 */
async update(request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryRecord>

/**
 * Forget one exact memory revision through the selected provider.
 * @param request - Workspace scope and compare-and-set reference to delete.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns resolution after durable deletion.
 */
async forget(request: MemoryForgetRequest, signal?: AbortSignal): Promise<void>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="ctxmemorycandidatereview--memorycandidatereviewservice"></a>

### `ctx.memoryCandidateReview` — `MemoryCandidateReviewService`

Host service exposing only projected candidate rows through the generated Remote.

```ts cordis-catalog
/**
 * Append one producer-owned candidate into the canonical queue.
 * This host-only method is intentionally not exposed as a browser Remote.
 * @param record - complete validated candidate row with a unique id.
 */
async recordCandidate(record: MemoryCandidateRecord): Promise<void>

/**
 * List one workspace partition, using the addressed Session as authorization anchor.
 * @param request - session anchor, filters, and bounded page coordinates.
 * @returns projected rows or an explicit ownership failure.
 */
@Remote('list') async list(request: MemoryCandidateReviewListRequest): Promise<MemoryCandidateReviewListResult>

/**
 * Record one immutable human decision and optionally persist an authorized candidate.
 * @param request - session authorization anchor, candidate id, and decision.
 * @returns the reviewed projection or an explicit business failure.
 */
@Remote('markReviewed') markReviewed(request: MemoryCandidateReviewMarkRequest): Promise<MemoryCandidateReviewMarkResult>
```

Source: [`packages/memory/tool-memory/src/review.ts`](../../packages/memory/tool-memory/src/review.ts)

<a id="memory-events"></a>

### `memory/*` events

<a id="memoryblocked--emit"></a>

#### `memory/blocked` — emit

A memory action was rejected before durable state could be mutated. Observers may surface the sanitized reason in security and integrity dashboards.

```ts cordis-catalog
/**
 * A memory action was rejected before durable state could be mutated.
 * Observers may surface the sanitized reason in security and integrity dashboards.
 * @param event - Block reason, source, workspace boundary, and optional safe detail.
 * @mode emit
 */
'memory/blocked'(event: MemoryBlockedEvent): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="memorycandidate--emit"></a>

#### `memory/candidate` — emit

Candidate retrieval was screened and assigned a deterministic policy outcome. Observers may persist or aggregate this non-model-facing audit telemetry.

```ts cordis-catalog
/**
 * Candidate retrieval was screened and assigned a deterministic policy outcome.
 * Observers may persist or aggregate this non-model-facing audit telemetry.
 * @param event - Candidate counts, operation source, and policy decision metadata.
 * @mode emit
 */
'memory/candidate'(event: MemoryCandidateEvent): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="memoryoperation--emit"></a>

#### `memory/operation` — emit

A durable memory operation completed or failed after provider selection. Observers may record operational health without changing the operation result.

```ts cordis-catalog
/**
 * A durable memory operation completed or failed after provider selection.
 * Observers may record operational health without changing the operation result.
 * @param event - Operation outcome, workspace boundary, provider, and optional result metadata.
 * @mode emit
 */
'memory/operation'(event: MemoryOperationEvent): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
