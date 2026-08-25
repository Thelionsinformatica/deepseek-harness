# 记忆

[English](memory.md) | 中文

记忆子系统为 Leon 提供持久、限定于工作区的事实，同时避免产品与某一种记忆引擎耦合。它拆分为服务定义（[dsh-memory](../../packages/memory/memory)，`ctx.memory`）、首个本地服务提供方（[dsh-memory-local](../../packages/memory/memory-local)，提供方 id 为 `local`）以及面向模型的消费方（[dsh-tool-memory](../../packages/memory/tool-memory)）。未来的 Letta 适配器可以实现同一提供方约定，而无须更改工具名称、工作区所有权或 Leon 其他部分接收的记录。

设计记录：[提供方中立的工作区记忆](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.zh.md)与[受控自动回忆](../../.agents/notes/implemented/architecture/2026-08-22-controlled-automatic-memory-recall.zh.md)。

## 所有权与隔离

每个操作都携带包含稳定 `WorkspaceId` 的 `MemoryScope`。原始目录路径绝不会成为所有权键。本地提供方在每次查找中都包含该作用域，并且会针对属于其他工作区的记录特意返回 `MEMORY_NOT_FOUND`，因此搜索结果与错误详情都不会泄露跨工作区数据。

`MemorySource` 记录显式创建事实的会话。这是来源信息而非所有权：在第一版约定中，工作区仍是唯一的隔离边界。

## 记录与操作词汇

| 类型 | 含义 |
|---|---|
| `MemoryId` | 独立于内容和提供方的稳定品牌化标识 |
| `MemoryRecord` | 规范化内容、作用域、会话来源、时间戳与修订号 |
| `MemoryRef` | 精确的 `{ id, revision }` 比较并设置引用 |
| `MemoryCreateRequest` | 工作区作用域、内容与来源会话 |
| `MemorySearchRequest` / `MemorySearchHit` | 有界查询与提供方排序的结果 |
| `MemoryUpdateRequest` | 针对某个精确修订号的替换内容 |
| `MemoryForgetRequest` | 删除某个精确修订号 |
| `MemoryProvider` | 创建/搜索/更新/遗忘的后端约定 |

源码：[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

纠正与删除都要求当前修订号。成功纠正会递增修订号；过时引用会以 `MEMORY_REVISION_CONFLICT` 失败，而不会覆盖更新后的知识。运行时会在请求到达提供方之前修剪内容与查询、执行长度边界、限制搜索结果数量并转发取消信号。

## 提供方选择与本地持久化

选择发生在执行时，绝不依赖插件注册顺序。显式配置的提供方必须已经注册且在本地可用。若未显式指定 id，则必须恰好有一个可用提供方；没有或存在多个候选时会产生结构化 `MemoryError` 代码。

`local` 提供方通过带版本的 `memory_local` 存储领域保存记录。它会串行化变更，在写入失败时保留已提交状态，执行确定性的大小写与重音不敏感词法搜索，并可跨进程重启保留数据。它不提供语义嵌入；后续向量或 Letta 提供方可以在相同服务约定之后加入更丰富的检索。

## 模型策略

`dsh-tool-memory` 提供四个工具：`memory_remember`、`memory_search`、`memory_update` 和 `memory_forget`。它通过 `ctx.workspaceRegistry` 解析活动会话目录，因此模型不会提供工作区 id 或原始路径。其提示词策略要求 Leon 在声称不知道持久上下文之前先搜索，只保留显式且稳定的事实，并且绝不存储密码、API 密钥、令牌、私钥或其他秘密。对话文本不会被自动捕获。

Leon preset 会在每轮第一次模型请求时启用有界自动回忆。查询只来自人类编写的文本，检索始终限制在当前 workspace，并把最多 4 个安全命中作为不超过 4,000 字符的不可信数据快照放在当前消息之前。面向模型的边界会拒绝类似凭据的写入并过滤类似凭据的搜索结果。提供方失败对自动回忆采用开放失败——轮次会在没有可选快照的情况下继续——而显式变更失败仍会成为可见工具错误。任何路径都不会自动写入记忆。

`tool-memory` 会为每个 `memory/candidate` 事件和每条持久影子候选记录发出确定性策略元数据：`policyVersion`、`policyDecision` 与 `policyReason`。候选遥测只携带临时查询的长度，绝不携带其文本，包括策略阻止查询或要求确认时。这为回放与审查工作流提供支持，但尚不改变回忆内容行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [LocalSemanticSearchEvent](memory-v2-retrieval.zh.md)

Source: [`packages/memory/memory-local/src/index.ts`](../../packages/memory/memory-local/src/index.ts)
<!-- END GENERATED cordis-surface -->
