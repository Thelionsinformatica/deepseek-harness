# Memory

English | [中文](memory.zh.md)

The memory subsystem gives Leon durable project facts and separately scoped personal facts without coupling the product to one memory engine. Workspace memory is split into a Service Definition ([dsh-memory](../../packages/memory/memory), `ctx.memory`) and a local Service Provider ([dsh-memory-local](../../packages/memory/memory-local), provider id `local`). Personal memory uses an independent Service Definition ([dsh-personal-memory](../../packages/memory/personal-memory), `ctx.personalMemory`) and isolated local provider ([dsh-personal-memory-local](../../packages/memory/personal-memory-local)). [dsh-tool-memory](../../packages/memory/tool-memory) is the model-facing Consumer for both. A [direct Letta provider was evaluated and not adopted](../evals/letta-memory-provider-experiment.md); a future candidate must pass the recorded safety, recall, latency, and cost thresholds.

Design records: [provider-neutral workspace memory](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.md), [controlled automatic recall](../../.agents/notes/implemented/architecture/2026-08-22-controlled-automatic-memory-recall.md), and [personal memory across workspaces](../../.agents/notes/implemented/feature/2026-08-25-leon-personal-memory.md).

## Ownership and isolation

Every operation carries a `MemoryScope` containing a stable `WorkspaceId`. Raw directory paths are never ownership keys. The local provider includes that scope in every lookup and deliberately returns `MEMORY_NOT_FOUND` for a record owned by another workspace, so neither search results nor error details reveal cross-workspace data.

`MemorySource` records the session that explicitly created a fact. This is provenance, not ownership: the workspace remains the isolation boundary for `ctx.memory`.

## Record and operation vocabulary

| Type | Meaning |
|---|---|
| `MemoryId` | stable branded identity independent of content and provider |
| `MemoryRecord` | normalized content, scope, session provenance, optional ranking metadata, timestamps, and revision |
| `MemoryRef` | exact `{ id, revision }` compare-and-set reference |
| `MemoryCreateRequest` | workspace scope, content, source session, and optional ranking metadata |
| `MemoryValidation` | `explicit` or `reviewed` confirmation class used by final ranking |
| `MemorySearchRequest` / `MemorySearchHit` | bounded query and provider-ranked result |
| `MemoryUpdateRequest` | replacement content for one exact revision |
| `MemoryForgetRequest` | deletion of one exact revision |
| `MemoryProvider` | create/search/update/forget backend contract |

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

Corrections and deletion require the current revision. A successful correction increments it; a stale reference fails with `MEMORY_REVISION_CONFLICT` instead of overwriting newer knowledge. The runtime trims and bounds content and queries before they reach a provider, caps search results, and forwards cancellation.

## Provider selection and local durability

Selection happens at execution time and never depends on plugin registration order. An explicitly configured provider must be registered and locally available. Without an explicit id, exactly one usable provider is required; zero or multiple candidates produce structured `MemoryError` codes.

The workspace `local` provider stores records through the versioned `memory_local` storage domain. It serializes mutations, preserves committed state when a write fails, performs deterministic case- and accent-insensitive lexical search, and survives process restart. It does not provide semantic embeddings; a later vector provider can add richer retrieval behind the same service contract.

## Personal memory

`ctx.personalMemory` uses `PersonalMemoryOwnerId` rather than a workspace or raw path. Its provider registry, events, and `personal_memory_local` storage domain are separate from workspace memory. The local provider reuses the same serialized temporal revision engine behind an adapter, but public records expose only `PersonalMemoryScope`; cross-owner access returns `PERSONAL_MEMORY_NOT_FOUND`.

The provider-neutral boundary rejects credential-like content before any provider write. The Leon deployment configures one explicit local owner label; it does not reuse the anonymous telemetry id and does not claim authenticated multi-user ownership. Local files are not encrypted by this subsystem and inherit the configured storage backend and operating-system protection.

## Model policy

`dsh-tool-memory` always contributes the four workspace tools `memory_remember`, `memory_search`, `memory_update`, and `memory_forget` when workspace services are present. A configured personal owner and `ctx.personalMemory` add `personal_memory_remember`, `personal_memory_search`, `personal_memory_update`, and `personal_memory_forget`. The model supplies neither workspace nor owner ids. Prompt policy permits writes only for explicit remember intent or clearly confirmed stable facts and forbids passwords, API keys, tokens, private keys, document bodies, and other secrets.

The Leon preset enables bounded automatic recall on the first model request of each turn for both scopes. The query comes only from human-authored text. Workspace retrieval remains in the current project, while personal retrieval remains in the configured owner partition; each snapshot is capped to four safe hits and 4,000 characters and is prepended as untrusted data. Provider failures fail open for recall, while explicit mutation failures remain visible tool errors. No path performs an automatic durable write.

`tool-memory` emits deterministic policy metadata for each `memory/candidate` event and each persisted shadow candidate row: `policyVersion`, `policyDecision`, and `policyReason`. Candidate telemetry carries only the transient query length, never its text, including when policy blocks the query or requires confirmation. This supports replay and review workflows without changing recall content behavior yet.

The browser review control also exposes a saved-memory administration tab. Its Host Remote resolves the requesting Session to one workspace, lists current and historical revisions by text and lifecycle status, redacts credential-like legacy content, and requires visible confirmation plus the exact revision before correction or forgetting. Mutations are recorded in a separate content-free `memory_admin` audit domain before durable state changes. `administrationMode: read-only` disables mutations without removing inspection, and none of these operations enter model context or change the four public memory tools.

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
 * Enumerate one bounded workspace partition for an authorized administrative surface.
 * @param request - Workspace scope, optional filters, and page coordinates.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns a stable page of provider-projected memory revisions.
 */
async list(request: MemoryListRequest, signal?: AbortSignal): Promise<MemoryListPage>

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
 * List durable memories for the addressed Session's exact workspace partition.
 * @param request - Session authorization anchor, lifecycle filters, and bounded page coordinates.
 * @returns Browser-safe workspace rows or an explicit administrative failure.
 */
@Remote('listMemories') async listMemories(request: MemoryAdminListRequest): Promise<MemoryAdminListResult>

/**
 * Correct one exact memory revision after explicit operator confirmation.
 * @param request - Session anchor, exact memory revision, replacement content, and confirmation.
 * @returns The corrected browser-safe row and audit id, or an explicit failure.
 */
@Remote('correctMemory') correctMemory(request: MemoryAdminCorrectRequest): Promise<MemoryAdminCorrectResult>

/**
 * Forget one exact memory lineage after explicit operator confirmation.
 * @param request - Session anchor, exact memory revision, and confirmation.
 * @returns The forgotten reference and audit id, or an explicit failure.
 */
@Remote('forgetMemory') forgetMemory(request: MemoryAdminForgetRequest): Promise<MemoryAdminForgetResult>

/**
 * List the configured local owner's personal memories without exposing the owner id.
 * @param request - Session authorization anchor and bounded list filters.
 * @returns Browser-safe personal rows plus the current enablement state, or an explicit failure.
 */
@Remote('listPersonalMemories') async listPersonalMemories(request: MemoryAdminListRequest): Promise<PersonalMemoryAdminListResult>

/**
 * Add one explicit personal fact after a visible confirmation.
 * @param request - Session provenance, complete fact, and explicit confirmation.
 * @returns The created browser-safe row and content-free audit id, or an explicit failure.
 */
@Remote('rememberPersonalMemory') rememberPersonalMemory(request: PersonalMemoryAdminRememberRequest): Promise<PersonalMemoryAdminRememberResult>

/**
 * Correct one exact personal-memory revision after confirmation.
 * @param request - Session anchor, exact revision, replacement text, and confirmation.
 * @returns The corrected browser-safe row and content-free audit id, or an explicit failure.
 */
@Remote('correctPersonalMemory') correctPersonalMemory(request: MemoryAdminCorrectRequest): Promise<MemoryAdminCorrectResult>

/**
 * Permanently remove one personal-memory lineage after confirmation.
 * @param request - Session anchor, exact personal-memory revision, and confirmation.
 * @returns The forgotten reference and content-free audit id, or an explicit failure.
 */
@Remote('forgetPersonalMemory') forgetPersonalMemory(request: MemoryAdminForgetRequest): Promise<MemoryAdminForgetResult>

/**
 * Persist the user's personal-memory enablement preference after confirmation.
 * @param request - Session anchor, desired state, and explicit confirmation.
 * @returns The applied enablement state and content-free audit id, or an explicit failure.
 */
@Remote('setPersonalMemoryEnabled') setPersonalMemoryEnabled(request: PersonalMemoryAdminToggleRequest): Promise<PersonalMemoryAdminToggleResult>

/**
 * Record one immutable human decision and optionally persist an authorized candidate.
 * @param request - session authorization anchor, candidate id, and decision.
 * @returns the reviewed projection or an explicit business failure.
 */
@Remote('markReviewed') markReviewed(request: MemoryCandidateReviewMarkRequest): Promise<MemoryCandidateReviewMarkResult>
```

Source: [`packages/memory/tool-memory/src/review.ts`](../../packages/memory/tool-memory/src/review.ts)

<a id="ctxpersonalmemory--personalmemoryruntime"></a>

### `ctx.personalMemory` — `PersonalMemoryRuntime`

Personal-memory service with an independent provider registry and lifecycle.

```ts cordis-catalog
/**
 * Register one personal-memory provider for the caller-controlled fiber lifetime.
 * @param provider - Provider implementation keyed by its stable id.
 * @returns disposer that removes this exact registration.
 */
registerProvider(provider: PersonalMemoryProvider): () => void

/**
 * Read whether model and mutation operations may use personal memory.
 * Administrative listing and forgetting remain available while disabled so the user can inspect or delete data.
 * @returns the current process-local operation state.
 */
isEnabled(): boolean

/**
 * Apply a deployment or durable-settings preference to all personal-memory Consumers.
 * @param enabled - Whether create, search, and correction operations may reach a provider.
 */
setEnabled(enabled: boolean): void

/**
 * Create one normalized personal fact in an explicit local-owner partition.
 * @param request - Owner scope, durable content, and session provenance.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns the durable normalized record.
 */
async create( request: PersonalMemoryCreateRequest, signal?: AbortSignal, ): Promise<PersonalMemoryRecord>

/**
 * Search one local-owner partition for relevant personal facts.
 * @param request - Owner scope, bounded query, and result limit.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns provider-ranked hits capped to the requested limit.
 */
async search( request: PersonalMemorySearchRequest, signal?: AbortSignal, ): Promise<readonly PersonalMemorySearchHit[]>

/**
 * Enumerate one bounded personal-memory partition for administration.
 * @param request - Owner scope, optional filters, and page coordinates.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns a stable page of personal-memory revisions.
 */
async list( request: PersonalMemoryListRequest, signal?: AbortSignal, ): Promise<PersonalMemoryListPage>

/**
 * Correct one exact personal-memory revision.
 * @param request - Owner scope, compare-and-set reference, and replacement content.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns the corrected record with an incremented revision.
 */
async update( request: PersonalMemoryUpdateRequest, signal?: AbortSignal, ): Promise<PersonalMemoryRecord>

/**
 * Forget one exact personal-memory revision.
 * @param request - Owner scope and compare-and-set reference to delete.
 * @param signal - Optional cancellation forwarded to the selected provider.
 * @returns resolution after durable deletion.
 */
async forget(request: PersonalMemoryForgetRequest, signal?: AbortSignal): Promise<void>
```

Source: [`packages/memory/personal-memory/src/index.ts`](../../packages/memory/personal-memory/src/index.ts)

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

<a id="memorysemantic-search--emit"></a>

#### `memory/semantic-search` — emit

Optional semantic retrieval completed or fell back without exposing query or memory text.

```ts cordis-catalog
/**
 * Optional semantic retrieval completed or fell back without exposing query or memory text.
 * @param event - Retrieval mode, bounded cost counters, and sanitized failure class.
 * @mode emit
 */
'memory/semantic-search'(event: LocalSemanticSearchEvent): void
```

Types: [LocalSemanticSearchEvent](memory-v2-retrieval.md)

Source: [`packages/memory/memory-local/src/index.ts`](../../packages/memory/memory-local/src/index.ts)

<a id="personal-memory-events"></a>

### `personal-memory/*` events

<a id="personal-memoryblocked--emit"></a>

#### `personal-memory/blocked` — emit

A personal-memory operation was rejected before durable mutation.

```ts cordis-catalog
/**
 * A personal-memory operation was rejected before durable mutation.
 * @param event - Sanitized operation, owner, reason, and error code.
 * @mode emit
 */
'personal-memory/blocked'(event: PersonalMemoryBlockedEvent): void
```

Source: [`packages/memory/personal-memory/src/index.ts`](../../packages/memory/personal-memory/src/index.ts)

<a id="personal-memoryoperation--emit"></a>

#### `personal-memory/operation` — emit

A personal-memory operation completed or failed without exposing its content.

```ts cordis-catalog
/**
 * A personal-memory operation completed or failed without exposing its content.
 * @param event - Content-free operation, provider, owner, and result metadata.
 * @mode emit
 */
'personal-memory/operation'(event: PersonalMemoryOperationEvent): void
```

Source: [`packages/memory/personal-memory/src/index.ts`](../../packages/memory/personal-memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
