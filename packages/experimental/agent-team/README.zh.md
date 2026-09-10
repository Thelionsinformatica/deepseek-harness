# @deepseek-ai/dsh-experimental-agent-team

[English](README.md) | 中文

隐式 Root Agent Teams 领域。`ctx.agentTeams` 在 Lead Session 日志中维护扁平的 Lead／teammate roster、持久 peer mailbox 与共享任务 DAG。[Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责协作和隔离决策；[Team 子系统目录](../../../docs/subsystems/agent-team.zh.md)记录持久数据的字面形态与服务 API。

## 配置

准入会在预留成员名称或名额之前拒绝不存在或没有 `prepareContinuable` 的提供方。准入后的失败仍记录为持久化失败成员，包括在创建过程中移除提供方的情况。

```yaml
- id: agent-team
  name: '@deepseek-ai/dsh-experimental-agent-team'
  config:
    maxMembers: 8
    maxTasks: 256
    maxPendingMessagesPerMember: 64
    maxMessageBytes: 65536
    disposalTimeoutMs: 5000
    completionRequiresReview: false
```

每个限制都必须是正的安全整数。`maxMembers` 统计所有曾 provision 的名字，包括失败成员，因为名字永不复用。`maxTasks` 统计未删除任务。mailbox 限额按目标成员计算；字节限制覆盖完整的投递帧，包括稳定 id 与发送者名称。`disposalTimeoutMs` 限制已获准创建、mailbox dispatch 与 Team 自有 Activation 的 settlement 时长，使插件 reload 与进程 shutdown 在异常时明确失败，而不是无限等待。

该服务要求 Agent、Session、Session persistence 与 continuable-subagent 服务。没有持久 Session 存储的组合不会激活它。

## Team 身份与 roster

每个普通运行时 Root 都是一个隐式 Team 的 Lead，其 `TeamId` 等于 `SessionId`；因此，在写入第一条成员、消息或任务记录前，创建 Team 不需要额外状态。teammate 是记录在 Root Session 中的具名 continuable 直接 child。名字采用小写 kebab-case，最长 64 个字符，在 Team 生命周期内不可变。Session id 始终是持久化与授权身份。

`spawnTeammate()` 先追加并 flush provisioning member，再要求配置的 spawn 或 fork provider 使用预留 child id 创建成员。provider 失败会追加持久 failed member。初始 inbox 消息获准后，先 flush child Session，再提交 active 边。Root 恢复时，只有独立持久 child 的直接 parent 与 continuable descriptor 匹配，并且其初始用户消息仍在持久 inbox 中或已经记录进历史，provisioning 才转为 active；否则转为 failed。如果 recovery 在同进程 provisioning 竞争中先完成，creator 会接受匹配终态，或报告 `TEAM_PROVISIONING_CONFLICT` 并 drain 已被 recovery 标为 failed 的 child。dispose 会关闭准入，中止并等待已获准的创建与 mailbox dispatch 事务，再让 continuation owner 释放 roster 中确切的 live direct child 及其后代；Lead 的非 Team continuable child 不受影响。cleanup 失败会让 dispose 明确失败。该对账覆盖 Root provisioning 与终态成员边之间的崩溃和 reload 窗口，同时不复用名字或遗留孤儿 Activation。

fresh child 不带 parent 历史 seed。fork child 只捕获一次 Lead 的已完成 turn 前缀，不包含正在执行 delegation 的 turn。继承的 Team 记录带有旧 Root 的 `TeamId`，普通 fork 成为独立运行时 Root 后会忽略这些记录。roster 之外、由 provider 管理的 subagent 不会被误认为嵌套 Team Lead。

roster 同时报告持久 provisioning／failed phase 与实时 `running`／`idle` 状态。active 但不驻留的 teammate 显示为 `inactive`；后续 wakeup 投递会经 continuation owner 冷恢复它。

## 持久 mailbox

`sendMessage()` 校验 peer 成员关系，追加 `team/message/queued` 并 flush，之后才尝试投递。结果始终标识该持久消息；`queued` 表示即时投递被推迟，并不表示需要重发。target 为 live 时，quiet 投递会立即注入、flush 并确认上下文，但绝不会激活 inactive target；inactive target 的 quiet 消息会保持 queued。wakeup 投递成为 target 的下一个 FIFO turn，并在需要时冷恢复它。

目标消息以 `Team message <id> from <name>:` 开头，并在 `TeamMessageSource` 中保留同一 id 与发送者。target Session 在 pending inbox 或已记录的用户消息历史中持久保存该身份后，Lead 日志才追加 `team/message/delivered`。即时准入按 target 和持久 queue 顺序串行化，恢复也按同一顺序重新投递 queued-minus-delivered 记录。重试前会同时折叠 live 与持久 target 的 inbox／历史状态，因此 inbox 已接受但模型尚未 claim 时发生崩溃也不会复制消息。Lead 日志 flush 成功后会唤醒当前 `waitForChange()` 调用方，调用方随后重新列出权威状态。

该保证是进程内重试加 target Session 去重，而不是跨进程 exactly-once。本版本没有跨进程共享 mailbox 事务，也没有 mailbox 时间线 UI。

## 共享任务板

任务是完整的版本化快照。每次变更都携带 `expectedRevision`；陈旧调用方会收到 `TEAM_TASK_STALE_REVISION`，不会覆盖更新值。任意成员都可以创建、读取或 claim ready 且无 owner 的任务。Owner 或 Lead 可以编辑、释放、完成、重开或删除任务；只有 Lead 可以分配给其他成员。数字 `task-<n>` id 的后缀必须是安全整数；最后一个安全 id 已被占用时，创建会报告 `TEAM_TASK_LIMIT`，而不会复用该 id。

依赖必须指向当前未删除任务，并组成完整 DAG，不允许 self edge 或重复 edge。只有所有 blocker 都 completed，pending 任务才 ready。仍被未删除任务依赖的任务不能删除。删除任务作为 tombstone 保留以供回放和维持 id 稳定，但不占用 `maxTasks`，也不出现在 `listTasks()` 中。

`writeScopes` 会规范化为 workspace-relative 路径前缀。view 会对与 in-progress 任务的重叠发出警告，但绝不会阻止 claim 或授予文件写权限。它们是协作提示，不是锁。

启用 `completionRequiresReview: true` 时，完成任务还需要通过 `registerCompletionReviewer()` 注册的唯一宿主审核器批准。任务事务先校验当前修订，再调用审核器，并保持串行执行直到审核结束。审核器缺失、拒绝、抛错或被撤销时，任务不能完成，其依赖任务也不会被释放。审核器负责证据验证，必须有执行时限，不得修改同一 Team，并须在重启后重新验证持久证据。注册属于可释放的宿主能力，不是模型工具或持久批准。该选项本身不实现任务预算、STOP、产物验证或文件系统隔离。

`waitForChange()` 可以等待注册后发生的下一条 roster、task、mailbox 或实时 status 边，时长范围为 10 秒到 1 小时；它只报告等待是否超时，也不会回放调用前已经发生的变化。运行时 dispose 会释放当前等待，并使后续等待不经超时立即返回。调用方需要在唤醒或超时后重新读取权威状态。取消会保留 Error reason；非 Error reason 则通过 `TEAM_WAIT_ABORTED` 以结构化检查结果报告，不再强制转成 object 字符串。`interrupt()` 仅限 Lead，并委托 continuable-subagent 的 interrupt 路径以 `keepInbox` 只取消 live teammate 的当前 turn；它既不释放任务 owner，也不删除持久 mail。

独立的 `./invariant` 配套模块会把每条候选 Team event 对照已提交 Session 前缀回放。回放会先验证每个当前版本 Team payload，再将其纳入折叠状态；随后会在 append 前拒绝非法 member 转换、名字复用、超出范围的数字 task id、不连续任务 revision、非法任务依赖、重复 queue／ack，以及 target 不匹配的 acknowledgement。顺序与时间由 Session event 的 `seq` 和 `time` 负责，不在 snapshot 中重复保存。

## 可选任务控制

独立的 `./mission-control` Loader 入口通过原生 `storageDomain` 提供 `ctx.teamMissions`。必须显式配置 `domainName`、`owner`、绝对路径 `workspace`、`maxCalls` 和 `durationMs`。普通 Team 入口不会挂载它。任务和消息仍以现有 Session 日志为真源。

宿主启动任务时固定目标、验收条件、截止时间和调用上限。原子预留在调用前消耗次数；并发调用方无法超过已存储的上限。检查版本的暂停和恢复操作保留消耗和截止时间。STOP 对该根会话是终态，重新打开存储后仍然有效；再次启动不能重置它。其他所有者或工作区不能复用该记录。

此入口是控制账本，不是完整执行器：它不拦截模型调用，不取消活动子进程，不串行化推理，也不限制本地路由或文件写入。宿主必须连接这些边界后才能启用任务。不支持多个进程共享同一存储。`team.cordis.snapshot.yml` 使用确定性适配器测试此入口，而非本地模型。

## 隔离导入实验

终态 STOP 基于任务最新修订提交，因此并发调用预留不会使使用旧修订发出的停止请求被拒绝。暂停/恢复仍要求观察到的修订。审核器抛出异常时暂停任务，不批准完成，保留原有上限，并允许检查后显式恢复。无论审核成功还是抛错，并发 STOP 均优先。在 `reviewing` 状态发生进程崩溃仍需要操作者核查。

`mission_task` 使用宿主读取的修订号启动或提交调用工作者的原生任务。并发启动串行执行而不复制任务；完成仍调用原生证据审核器。实验隐藏通用任务修改工具，并在最终调度时拒绝它们。不建立第二个任务存储。

`mission_task_complete` 是兼容别名，使用相同的 phase 参数和审核器。每轮八步后将控制权交回宿主，不更新任务预算。最终审核在收集证据前原子关闭新的推理准入；在 `reviewing` 状态崩溃不会自动批准或恢复。

`examples/headless-agent/collective.cordis.yml` 在普通配置之外组合 `./execution` 和 `./import-lab`。执行入口检查任务状态、固定提供方/模型及最终工具白名单，串行化生成，在调度前预留调用，并在暂停/STOP 时取消活动轮次。部署必须验证真实本地服务；回环 URL 本身不能证明本地推理。

`lib/lab-bin.js run <absolute-empty-directory> <absolute-config>` 建立独占所有者锁和受限导入策略样例。它复用原生 Team 会话、任务和消息。只有 Lead 能凭当前摘要修改该样例。不暴露任意代码、shell、文件系统或网络工具。宿主验证当前输出、已完成任务，以及工作者接收同伴证据后的验证。这是狭窄演示，不是通用编码沙箱或生产集成。

运行器从标准输入接受 `status`、`pause`、`stop`。退出后 `resume` 仅接受暂停任务；STOP 持久化且为终态。离线 `status` 和 `stop` 使用同一目录/配置。崩溃后遗留的 `.owner.lock` 必须检查 PID 后由操作者处理；不得删除活动所有者锁。恢复及纠正反馈均不延长原预算或期限。

标准输入暂停控制器在任务仍运行时重试陈旧修订，次数上限为剩余调用额度加一。其他失败写入 stderr；只有已提交的控制变更才会在 stdout 确认。服务保留暂停和恢复的修订检查。这不提供突然崩溃后的恢复。

实验通过原生持久化上下文快照注入真实身份、成员和任务视图。这增加上下文 token，并改变动态后缀而不重写静态身份。工具结果和同伴消息仍进入普通会话日志。确定性 Loader 测试证明组合，不证明 Qwen 能力或硬件性能。

可选执行配置 `reviewReserve: { calls, reviewerName }` 将任务最后正整数次调用预留给指定 teammate，不包括 Lead；必须至少留出一次普通调用。执行器取得推理 slot 后、预订调用前检查持久计数器，拒绝的尝试不消耗预算。省略配置保持普通准入规则。这不会安排审核、保证产物有效，也不会阻止审核者将额度用于无关工作。宿主必须请求并验证最终证据；宿主直接预订调用和多个运行时进程的并发操作不在此执行器策略范围内。

## 模型体验

### Peer 消息

#### 模型看到的内容

每条已投递 peer 消息都是用户角色消息。第一个短文本块包含稳定消息 id 与发送者，之后原样附加发送者的内容块。roster、task 和 mailbox 记录本身只存在于日志，不进入派生模型历史。

#### Token 影响

每次 peer 投递都会把发送者前缀与消息内容加入 target 历史。任务和 roster 变更不增加模型 token；其面向模型的呈现属于 `@deepseek-ai/dsh-experimental-tool-agent-team` 结果。

#### KV Cache 影响

Peer 消息追加在 target 可复用历史前缀之后。冷恢复会先复用持久对话，再追加尚未投递的消息。

## 已知限制与暂缓事项

- **单进程、共享 checkout**：所有成员共享 cwd，修改立即可见；本包不提供 worktree、远端成员、自动 merge 或文件锁。
- **write scope 仅作提示**：Bash、formatter、codegen 和直接外部写入可以绕过文件版本检查；Lead 必须协调 owner 并检查最终 diff。
- **扁平且不可变的 roster**：只有 Lead 可以创建直接 teammate；不支持嵌套 Team、重命名、删除或名字复用。
- **不会自动释放 owner**：idle、interrupt、进程退出与工作失败都不会释放任务 owner。
- **mailbox 不保证跨进程 exactly-once**：不支持多个 harness 进程并发操作同一 Team。
