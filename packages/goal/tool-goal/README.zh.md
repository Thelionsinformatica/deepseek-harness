# @deepseek-ai/dsh-tool-goal

[English](README.md) | 中文

[`ctx.goals`](../goal/README.zh.md) 的面向模型控制 API：`get_goal`、`create_goal` 和 `update_goal`。[goal 工具 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-model-facing-goal-tools.zh.md) 负责权限拆分与 Codex 风格用户体验。

## 工具

- `get_goal()` 返回当前 goal 或 `null`，包括比较并设置 id／revision、持久 phase、Goal Round 的已准入数／上限、任何 blocker reason，以及当前进程本地续行启用状态。
- `create_goal(objective, max_goal_rounds?)` 根据人类直接发起的顶层轮次创建一个 goal。模型可以推断长期运行的 goal 意图，而无需精确命令短语；非人类轮次和 subagent 会在执行时被拒绝。
- `update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)` 支持 `edit`、`pause`、`resume`、`complete` 和 `blocked`。替换值只属于 `edit`；`blocked_reason` 只有在 action 为 `blocked` 时才必填，并以稳定代码 `model-reported` 持久化。严格 schema 下的空字符串和零填充值视为省略，而有意义的值仍限定到各自 action。

所有调用都互斥，因此模型排序的批次能观察到更早变更及其新 revision。UI 客户端会收到纯通用卡片：`get_goal` 使用 read，变更使用 other。变更卡片选择第一个有意义的 action 值，否则显示 goal id，因此已接受的填充值绝不会产生空输入。

3 个规范值都与已经渲染给 Native 调用方的紧凑 JSON 一致：`{ goal: null }` 或 `{ goal: { id, revision, objective, phase, roundsStarted, maxGoalRounds, blockedReason? }, activation }`。因此，编程消费方无需解析渲染后的 JSON，即可收到相同领域结构。

配置独立审核后，`complete` 调用会以 `Verify delivery` 保持 pending，同时一个全新的一次性 subagent 检查继承的工作区。审核器接收目标和当前任务列表，使用配置的模型路由，返回经过 schema 校验的通过／拒绝结论，并且不能调用编辑、委派、goal、todo、workflow 或 Code Mode 工具。拒绝、无效或不可用的结论会让 goal 保持 active，并把有长度上限的可操作反馈作为失败的工具结果返回；只有无发现项的通过结论才允许比较并设置的完成变更。

自主 Goal Round 成功报告 `complete` 或 `blocked` 时，会收到一条延迟的收尾指令，使 assistant 在普通的无工具调用停止前仍会报告结果。人类直接变更不会收到该指令：assistant 可以确认变更，循环仍可接收并发的人类 steering（中途引导）。

## 权限

隔离审核器接收宿主捕获的父会话及直接子会话执行 JSON。`completionAuditorEvidenceMaxCharacters`（默认 24000）限制每次交付；超限时采用下文审查生命周期中的分页，不会静默截断。流式片段和模型推理不在记录中。返回文本是不可信证据，不能证明子 agent 的声明属实。这会增加审核输入 token，不改变普通轮次提示。

执行要求完全相同的活跃 `exec.agent`、其继承的 `AgentRegistry` initiator、running 状态与开放轮次。create、edit、pause 和 resume 还要求运行时根 agent（智能体）的当前轮次中存在已接受的 `{ kind: 'user' }` 消息或 steering 事件。持久 fork 谱系不会降低已恢复根 agent 的等级；活跃 subagent 所有权会降低。

`{ kind: 'user' }` 是宿主证明。`Agent.followup()` 与 `steer()` 会在调用方省略 source 时分配该值，因此插件、调度器与其他非人类生产方必须传入自己的 source，不能继承用户权限。

complete 与 blocked 还接受完全一致的当前 Goal Round：来源为 goal 的 `user/message`，其 id、revision 和 Round 编号与折叠后的当前 goal 相等。在达到 `blockedAfterConsecutiveRounds` 前，Goal Round 的 blocked 调用会被机械拒绝；模型判断同一条件是否确实持续，并必须在 `blocked_reason` 中说明。人类直接授权可以立即停止 goal。

## 配置

```yaml
- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'
  config:
    blockedAfterConsecutiveRounds: 3
    completionRequiresCompletedTodos: true
    completionAuditorProvider: spawn
    completionAuditorModelProvider: google
    completionAuditorModel: gemini-3.6-flash
    completionAuditorMaxTokens: 4096
    completionAuditorMaxAttemptsPerTurn: 2
    completionAuditorReportMaxCharacters: 6000
    completionAuditorTools: []
    completionAuditorArtifactMaxFiles: 64
    completionAuditorArtifactMaxBytes: 1048576
    completionAuditorRequireArtifacts: true
```

`blockedAfterConsecutiveRounds` 必须是正的安全整数。它既提供模型自行报告阻塞的硬下限，也决定模型指引中指明的数值。当 `completionRequiresCompletedTodos` 为 true 时，只有当前 goal 已存在非空的 `todo_write` 列表且所有条目均为 `completed`，`complete` 才会被接受；列表未完成时，拒绝结果会返回完整规范列表，包括已完成条目，使重试能够保留每个内容字符串与相对顺序、更新状态并保留真正新发现的条目。为兼容既有组合，默认值为 false。

空的 `completionAuditorProvider` 会禁用独立审核。非空值要求一次性提供方声明支持宿主 `setup`；缺失时在推理前拒绝。`completionAuditorModelProvider` 与 `completionAuditorModel` 必须同时配置，或者同时省略以继承执行器路由；已组合的辅助 `review` 选择优先。正安全整数限制输出 token、每轮启动次数、反馈及产物证据。委派后的 sandbox／approval 策略仍然继承。

`completionAuditorTools` 默认为空允许列表。宿主在发布或推理前安装子级执行守卫：只允许 `completion_evidence_read`、`completion_artifact_read`、`structured_output` 及明确配置的验证工具。守卫也检查继承工具过滤器无法约束的子级自有工具及嵌套调用。额外名称必须存在于父级工具中；应使用功能受限的只读验证器，而不是通用 shell。宿主仍对其实现负责。

`completion_artifact_read({ file_path })` 通过当前 `ctx.fs` 提供方返回完整 UTF-8 文件、字节数及 SHA-256。它将读取限制在指定工作区内，拒绝常见凭据路径、Windows 流语法、二进制或超限内容，并仅记录成功且未改变的最终交付。冒号仅用于路径开头的 Windows 盘符，包括扩展路径；所有提供方都拒绝其他含冒号的名称。普通盘符路径和 UNC 路径仍受工作区包含检查约束。默认最多 64 个路径，每个文件 1048576 字节。为兼容非文件目标，`completionAuditorRequireArtifacts` 默认为 false；设为 true 时必须至少交付一个文件，仅有文字 PASS 不够。

## 审查生命周期

`update_goal action: review` 调用已配置的独立审查员，但不完成目标，也不修改待办事项。审查通过后，结果返回 `review.status`、审查会话 ID 和有长度限制的摘要。更新审查待办状态后，`complete` 仅在同一开放轮次、相同目标修订、任务内容不变且没有执行其他工作工具时复用该 PASS。新工作、新轮次或需求变更要求重新审查；未完成的待办仍会阻止目标完成。

审查证据包含宿主捕获的父会话工具调用与结果，以及直接子会话的执行记录和实际模型来源。覆盖范围明确标记为 `live-only` 或 `live-and-persisted`。超出 `completionAuditorEvidenceMaxCharacters` 的证据由 `completion_evidence_read` 分页提供，每页均受大小限制。只有指定的审查员可读取，运行结束后权限失效。宿主在所有页面交付前拒绝 PASS；交付不等于理解。原始会话记录不会被截断或覆盖。

新回执包含 `artifacts` manifest（元数据清单），覆盖标记为 `files-reviewed` 或 `no-files-reviewed`。审查结束后以及同轮复用前，都会重新检查完整字节及提供方目标身份。文件变化或缺失会以 `GOAL_QUALITY_AUDIT_ARTIFACT_STALE` 拒绝完成；执行器必须明确请求新审查。旧回执仍可读取，但不能授权复用。回执不存文件内容；子级工具结果仍作为普通证据记录。参见[审查边界决策](../../../.agents/notes/implemented/bug-fix/2026-09-21-completion-audit-boundaries.zh.md)。

## 模型体验

### 系统提示词

#### 模型看到的内容

固定 goal 策略说明何种用户语义意图值得创建 goal，要求更新前先精确读取 ref，说明部署可能已经创建 goal，解释会话 resume／fork 后如何重新启用续行，并限制完成／阻塞声明。配置的阻塞、todo 完成与独立审核规则会插入该指引。

##### Goal 策略

```markdown
Use goal tools only for one long-running objective; skip routine single-turn work. create_goal may infer goal intent from a direct human request in any language. A deployment may create it automatically: call get_goal first, then use exact goal_id/revision. Resuming a session or forking it disarms an active goal; any human continue or resume request in any wording or language requires update_goal action resume. Complete only when achieved. Block only after the same condition lasts at least 3 consecutive goal rounds; set blocked_reason. Difficulty, uncertainty, or remaining work are not blockers. Completion needs a non-empty todo_write list with all items done. An incomplete-list rejection returns the complete canonical list; preserve content/order, update statuses, retain legitimate new items, then retry. Use action review to request independent review before marking review bookkeeping completed. A successful review leaves the goal active and never completes todos. Then finish bookkeeping and call complete in the same turn without other work. Complete reuses that current PASS; otherwise it starts a fresh audit. Never mark a review todo completed before PASS. If rejected, fix findings and revalidate before retrying.
```

#### Token 影响

此插件的提示词注册位于请求范围内时，每次请求都会产生少量固定输入成本。每次配置的完成尝试会增加一个全新审核器上下文及其工具结果，受 `completionAuditorMaxTokens` 和 `completionAuditorMaxAttemptsPerTurn` 限制。

#### KV Cache 影响

插件范围、配置阈值和指引文本不变时，前缀保持稳定。启用、dispose（资源释放）或配置变更可能使此提示词章节的复用失效。

### 工具 schema 与结果

#### 模型看到的内容

生成的 [`get_goal`、`create_goal` 和 `update_goal` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-goal)。成功结果是紧凑 JSON。任务未完成而被拒绝的完成调用会包含完整规范 `todo_write` 列表。变更会追加 goal 领域的持久 `goal/change` 事件，而不会将模型上下文加入队列。结果中的 `activation` 是实时观察值，绝不会成为回放权限依据。

#### Token 影响

固定 schema 成本，加上每次调用的一条结果。成功结果很小；未完成任务的拒绝成本随当前列表增长。持久变更不会增加单独的模型可见上下文。

#### KV Cache 影响

schema 的定义与可见性不变时，前缀保持稳定。调用和结果会追加到可复用请求前缀之后，不会使更早条目失效。

## 已知限制与暂缓事项

- **证据范围** — 仅覆盖直接子会话，不递归。没有持久化时无法验证冷会话。哈希覆盖实际读取的文件，而非所有必需产物或语义正确性。它检测已观察到的变化，不检测最后一次检查后的写入；没有工作区锁或全局写入屏障。空覆盖不代表文件验证。

- **语义意图仍由模型判断**：执行只能证明当前轮次包含一条人类直接发送的消息，无法证明请求是否足够重大而值得创建 goal。
- **阻塞条件是否相同仍由模型判断**：运行时强制统计互不重复的已准入 Goal Round，而不判断障碍在语义上是否等价；完成审核器不评估 blocked 报告。
- **宿主扩展仍受信任** — 允许列表不是针对恶意宿主插件的操作系统沙箱。明确授予通用 shell 会破坏只读意图。凭据名称过滤并非通用秘密检测。文件内容遵循审核器配置的模型路由，包括已配置的外部提供方。
- **不负责调度或直接面向人类呈现**：这些工具只变更状态；同会话驱动器与 [`dsh-command-goal`](../command-goal/README.zh.md) 是同一领域的独立消费方。
- **Goal Round 权限需要驱动器**：除非续行驱动器准入 goal 来源的用户轮次，否则自主 `complete`／`blocked` 路径不会启用；只挂载这个包不会创建这些轮次。
- **提示词注册与过滤相互独立**：某个范围可能隐藏工具，却保留指引，除非部署将两项注册限定在同一范围。
