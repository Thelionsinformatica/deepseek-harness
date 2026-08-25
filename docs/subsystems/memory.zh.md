# 记忆

[English](memory.md) | 中文

记忆子系统为 Leon 提供持久项目事实与独立作用域的个人事实，同时避免产品与某一种记忆引擎耦合。Workspace 记忆由服务定义（[dsh-memory](../../packages/memory/memory)，`ctx.memory`）和本地服务提供方（[dsh-memory-local](../../packages/memory/memory-local)，提供方 id 为 `local`）组成。个人记忆使用独立的服务定义（[dsh-personal-memory](../../packages/memory/personal-memory)，`ctx.personalMemory`）与隔离的本地提供方（[dsh-personal-memory-local](../../packages/memory/personal-memory-local)）。[dsh-tool-memory](../../packages/memory/tool-memory) 是两者面向模型的 Consumer。[直接 Letta provider 已经过评估但未采用](../evals/letta-memory-provider-experiment.zh.md)；未来候选必须通过已记录的安全、recall、延迟和成本门槛。

设计记录：[提供方中立的工作区记忆](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.zh.md)、[受控自动回忆](../../.agents/notes/implemented/architecture/2026-08-22-controlled-automatic-memory-recall.zh.md)和[跨 workspace 个人记忆](../../.agents/notes/implemented/feature/2026-08-25-leon-personal-memory.zh.md)。

## 所有权与隔离

每个操作都携带包含稳定 `WorkspaceId` 的 `MemoryScope`。原始目录路径绝不会成为所有权键。本地提供方在每次查找中都包含该作用域，并且会针对属于其他工作区的记录特意返回 `MEMORY_NOT_FOUND`，因此搜索结果与错误详情都不会泄露跨工作区数据。

`MemorySource` 记录显式创建事实的会话。这是来源信息而非所有权：workspace 仍是 `ctx.memory` 的隔离边界。

## 记录与操作词汇

| 类型 | 含义 |
|---|---|
| `MemoryId` | 独立于内容和提供方的稳定品牌化标识 |
| `MemoryRecord` | 规范化内容、作用域、会话来源、可选排序元数据、时间戳与修订号 |
| `MemoryRef` | 精确的 `{ id, revision }` 比较并设置引用 |
| `MemoryCreateRequest` | 工作区作用域、内容、来源会话与可选排序元数据 |
| `MemoryValidation` | 最终排序使用的 `explicit` 或 `reviewed` 确认类别 |
| `MemorySearchRequest` / `MemorySearchHit` | 有界查询与提供方排序的结果 |
| `MemoryUpdateRequest` | 针对某个精确修订号的替换内容 |
| `MemoryForgetRequest` | 删除某个精确修订号 |
| `MemoryProvider` | 创建/搜索/更新/遗忘的后端约定 |

源码：[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

纠正与删除都要求当前修订号。成功纠正会递增修订号；过时引用会以 `MEMORY_REVISION_CONFLICT` 失败，而不会覆盖更新后的知识。运行时会在请求到达提供方之前修剪内容与查询、执行长度边界、限制搜索结果数量并转发取消信号。

## 提供方选择与本地持久化

选择发生在执行时，绝不依赖插件注册顺序。显式配置的提供方必须已经注册且在本地可用。若未显式指定 id，则必须恰好有一个可用提供方；没有或存在多个候选时会产生结构化 `MemoryError` 代码。

Workspace `local` 提供方通过带版本的 `memory_local` 存储 domain 保存记录。它会串行化变更，在写入失败时保留已提交状态，执行确定性的大小写与重音不敏感词法搜索，并可跨进程重启保留数据。它不提供语义嵌入；后续向量提供方可以在相同服务约定之后加入更丰富的检索。

## 个人记忆

`ctx.personalMemory` 使用 `PersonalMemoryOwnerId`，而不是 workspace 或原始路径。它的提供方注册表、事件与 `personal_memory_local` 存储 domain 均与 workspace 记忆分离。本地提供方通过适配器复用相同的串行时间 revision 引擎，但公开记录只暴露 `PersonalMemoryScope`；跨所有者访问返回 `PERSONAL_MEMORY_NOT_FOUND`。

提供方中立边界会在任何提供方写入前拒绝类似凭据的内容。Leon 部署配置一个显式本地所有者标签；它不会复用匿名遥测 id，也不声称拥有经过身份验证的多用户所有权。本子系统不会加密本地文件，文件继承已配置存储后端与操作系统保护。

## 模型策略

当 workspace 服务存在时，`dsh-tool-memory` 始终提供四个 workspace 工具：`memory_remember`、`memory_search`、`memory_update` 和 `memory_forget`。配置个人所有者并存在 `ctx.personalMemory` 时，还会增加 `personal_memory_remember`、`personal_memory_search`、`personal_memory_update` 与 `personal_memory_forget`。模型既不提供 workspace id，也不提供所有者 id。提示词策略只允许在明确记住意图或已经清楚确认的稳定事实时写入，并禁止密码、API key、token、private key、文档正文和其他 secret。

Leon preset 会在每轮第一次模型请求时为两个作用域启用有界自动回忆。查询只来自人类编写的文本。Workspace 检索留在当前项目，个人检索留在已配置所有者分区；每个快照最多包含 4 个安全命中和 4,000 字符，并作为不可信数据放在当前消息之前。提供方失败对自动回忆采用开放失败，显式变更失败仍会成为可见工具错误。任何路径都不会自动执行持久写入。

`tool-memory` 会为每个 `memory/candidate` 事件和每条持久影子候选记录发出确定性策略元数据：`policyVersion`、`policyDecision` 与 `policyReason`。候选遥测只携带临时查询的长度，绝不携带其文本，包括策略阻止查询或要求确认时。这为回放与审查工作流提供支持，但尚不改变回忆内容行为。

浏览器审查控件还提供已保存记忆管理标签页。其 Host Remote 会把请求 Session 解析到单一 workspace，按文本和生命周期状态列出当前与历史修订，遮蔽旧记录中类似凭据的内容，并在纠正或遗忘前要求可见确认与精确 revision。变更会在持久状态改变前写入独立且不含内容的 `memory_admin` 审计域。`administrationMode: read-only` 可在保留查看能力的同时禁用变更；这些操作不会进入模型上下文，也不会改变四个公开记忆工具。

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

Types: [LocalSemanticSearchEvent](memory-v2-retrieval.zh.md)

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
