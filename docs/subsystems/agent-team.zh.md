# Agent Teams

[English](agent-team.md) | 中文

实验性隐式 Root Team 领域、模型工具与宿主适配器共享的类型。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责身份、mailbox、task 与共享 checkout 决策；本页记录 [`packages/experimental/agent-team/src/types.ts`](../../packages/experimental/agent-team/src/types.ts) 中的字面持久形式。

## 身份与 roster

`TeamId` 是具有独立[品牌](core.zh.md#branded-ids)的 Root `SessionId`。`TeamTaskId` 在 Team 内按 `task-<n>` 单调分配；`TeamMessageId` 是全局随机值。teammate 的 Session id 始终是持久身份，而 `name` 是不可变的模型／UI 标签。

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

每个 member 都从 `provisioning` 开始，并且只到达一个终态 roster phase：`active` 或 `failed`。运行时 `running`／`idle`／`inactive` 状态单独派生，绝不会重写该记录。

## 持久 mailbox

Lead Session 首先存储完整 queued message。只有 target 的 pending inbox 条目或已记录用户消息完成持久化，才会写入独立 acknowledgement event，queued-minus-delivered 因而构成恢复 mailbox。

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}
```

target Session 会在 pending inbox 条目和最终用户消息上保留消息身份与发送者归因。跨 inbox 与历史折叠该 source 构成 target 侧去重键；模型可见的 framing 会重复 id 和发送者。

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示尚未开始或已经释放，`in_progress` 携带 owner，`completed` 满足 blocker，`deleted` 是保留的 tombstone。view 会添加 owner name、readiness 和 write-scope 重叠警告，但不会改变持久快照。

## 回放

`foldTeam()` 把一个 Root Session 回放成每个 Team 操作所读取的 roster、任务板与 queued-minus-delivered mailbox。它按 `TeamId` 选取记录，因此普通 fork 继承的 event 保留 ancestor id，绝不会进入新 Root 的状态。Session event 的 `seq` 与 `time` 继续负责顺序和时间记录，Team snapshot 不再重复保存它们。roster 与 task 读取以 view 形式到达调用方，附带 owner name、readiness 与 write-scope 警告，而 pending 邮件仅供投递与恢复内部使用。包 [README](../../packages/experimental/agent-team/README.zh.md)负责 operation、authorization、recovery 和限制行为。

## 宿主完成审核

`TeamCompletionReviewer` 接收确切的调用方、根 Agent 和独立的当前 `TeamTaskSnapshot`，返回 `Promise<boolean>`。启用 `completionRequiresReview` 时，任务板在串行修订检查内要求宿主唯一可释放注册的批准。宿主审核器负责证据新鲜度和执行时限；不得修改同一 Team。注册不会跨重启保留，撤销会使进行中的批准失效。正常默认不要求审核。参见[包约定](../../packages/experimental/agent-team/README.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * Register the sole trusted completion reviewer; models cannot register one through Team tools.
 * The owner must verify current evidence and policy on every call, including after restart.
 * @param reviewer - bounded host verifier; must not call a Team mutation while holding its transaction.
 * @returns disposer; disposal during a pending review also rejects that completion.
 */
registerCompletionReviewer(reviewer: TeamCompletionReviewer): () => void

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, scheduling mode, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/agent-team/src/index.ts`](../../packages/experimental/agent-team/src/index.ts)

<a id="ctxteammissions--teammissioncontrol"></a>

### `ctx.teamMissions` — `TeamMissionControl`

Host-only state transitions and atomic reservations; not a model-facing authorization API.

```ts cordis-catalog
/**
 * Read and verify durable functional identities against the current native roster.
 * @param caller - exact live Lead, including after a cold resume.
 * @returns detached immutable host assignments; unready or changed rosters reject.
 */
getComposition(caller: Agent): TeamMissionBindings

/**
 * Inspect a stored mission without materializing an agent or draining its inbox.
 * @param id - root identity selected by the isolated, authenticated host entry.
 * @returns detached scope-checked control state; this read does not mutate or emit events.
 */
inspectStored(id: SessionId): TeamMissionRecord

/**
 * Commit terminal STOP for an inactive root without loading any participant session.
 * The host must hold the same exclusive directory ownership used by the live runner.
 * @param id - root identity selected outside model/tool initiator scope.
 * @returns durable cancelled record; no lifecycle notification can activate pending inbox work.
 */
async stopStored(id: SessionId): Promise<TeamMissionRecord>

/**
 * Provision exactly two native continuable workers before admitting model calls.
 * Failure retains every roster/session record and blocks the mission without renewing limits.
 * @param caller - exact Lead invoked outside model/tool initiator scope.
 * @param request - host-authored research and check requests; labels grant no authority.
 * @returns persisted function-to-session assignments after full roster validation.
 */
async provisionTeam(caller: Agent, request: TeamMissionProvisionRequest): Promise<TeamMissionBindings>

/**
 * Wait after message durability but before reservation/inference for host composition.
 * @param caller - exact current Lead resolved from the requesting participant.
 * @param signal - request cancellation; the original mission deadline also bounds waiting.
 * @returns validated function assignments; STOP, orphan provisioning, failure and extras reject.
 */
async waitForComposition(caller: Agent, signal: AbortSignal): Promise<TeamMissionBindings>

/**
 * Start one host-authorized mission; a root can never reset its consumed budget.
 * @param caller - exact live Lead; caller authentication remains the host entry's responsibility.
 * @param objective - authorized outcome, not a worker instruction.
 * @param criteria - frozen acceptance text; cannot be edited through this API.
 * @returns durable initial record; duplicate starts reject.
 */
async start(caller: Agent, objective: string, criteria: string): Promise<TeamMissionRecord>

/**
 * Read detached control state without exposing another configured workspace.
 * @param caller - exact live Lead.
 * @returns current durable control state.
 */
get(caller: Agent): TeamMissionRecord

/**
 * Persist pause, terminal STOP, or an explicit resume from paused only.
 * This transition does not itself cancel an in-flight model or subprocess.
 * @param caller - exact live Lead used by the authenticated host control.
 * @param revision - observed revision for pause/resume; terminal STOP uses the latest committed record.
 * @param action - host control action; cancelled missions cannot resume.
 * @returns committed record, without resetting deadline, criteria or counters.
 */
async transition(caller: Agent, revision: number, action: 'pause' | 'stop' | 'resume'): Promise<TeamMissionRecord>

/**
 * Durably spend one attempt before dispatch; failed calls are not refunded.
 * @param caller - exact Lead selected by the runtime's mission resolver.
 * @returns committed reservation number; paused, cancelled, expired or exhausted missions reject.
 */
async reserveCall(caller: Agent): Promise<number>

/**
 * Commit a host-verified outcome without granting a model an approval tool.
 * @param caller - exact live Lead controlled by the host runner.
 * @param verify - trusted verifier of current artifacts and native task evidence.
 * @returns committed outcome; verifier exceptions pause without approval or budget renewal, and concurrent controls win.
 */
async finish(caller: Agent, verify: () => Promise<{ passed: boolean; summary: string }>): Promise<TeamMissionRecord>

/**
 * Reject new control calls and await admitted provisioning before closing its storage.
 * @returns once every admitted provisioning operation has settled.
 */
async close(): Promise<void>
```

Types: [Agent](core.zh.md) · [SessionId](core.zh.md)

Source: [`packages/experimental/agent-team/src/mission-control.ts`](../../packages/experimental/agent-team/src/mission-control.ts)

<a id="team-mission-events"></a>

### `team-mission/*` events

<a id="team-missionchanged--parallel"></a>

#### `team-mission/changed` — parallel

Notification after a durable mission control transition commits.

```ts cordis-catalog
/**
 * Notification after a durable mission control transition commits.
 * @param lead - exact authorized root Agent.
 * @param record - detached committed record, not a second source of truth.
 * @mode parallel
 */
'team-mission/changed'(lead: Agent, record: TeamMissionRecord): Promise<void>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/agent-team/src/mission-control.ts`](../../packages/experimental/agent-team/src/mission-control.ts)
<!-- END GENERATED cordis-surface -->
