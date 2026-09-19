# Agent Note: 会话归档与永久生命周期控制

Status: implemented

[English](2026-07-31-session-archive-global-set.md) | 中文

## 问题

侧边栏 workspace 浏览器的会话行菜单最初只有一个纯视觉的「Delete session」占位项。隐藏会话与销毁历史不是同一种操作：归档必须保留规范日志和 workspace 位置，而永久删除必须协调可能仍存活的 Agent、append 串行化、派生记录、workspace 记账以及所有已连接 client；它既不能允许迟到写入复活该身份，也不能在持久化工作完成前发布成功。归档记录还需要注册表级全局落点，因为 Ungrouped 会话不属于任何 workspace 实体。用户的 workspace 文件、个人记忆和内容寻址附件具有独立于单个会话的生命周期，不能误当成会话自有数据。

## 决策

**归档是可逆的注册表级全局可见性覆盖，恢复是它的逆操作；永久删除是由 gateway 明确编排的生命周期，只移除一个会话身份对应的 Leon 自有记录，并在完整清理提交后发布移除。**

- 归档存储仍是 `workspaceDomainState.archivedSessionIds: z.array(sessionId).default([])`，domain version 保持 2。旧介质通过 schema default 解析为空集合。已归档会话保留其 `sessionIds` workspace slot，因此归档不改变「一个会话只由一个 workspace 记账」的不变式，恢复时会话会在原位置重新出现。
- `WorkspaceRegistry.archiveSession(id)` 与 `unarchiveSession(id)` 都通过 `enqueueOperation` 执行，其 `archivedSessionIds` getter 会公开只读集合。归档会拒绝实时与持久化中都不存在的身份，对已有成员保持幂等；RPC 会把该 miss 映射为 `session-not-found`。取消归档在 id 不属于集合时保持幂等。`workspace.archiveSession` 与 `workspace.unarchiveSession` 返回完整的已提交 `archivedSessionIds` 快照，`workspace.list` 提供重连基线，`host/archived-sessions-changed` 在持久变更后发布相同的完整快照。
- client 运行时把 `WorkspaceListState.archivedSessionIds` 保持为按 Host 顺序排列的 `readonly SessionId[]`，因为公有快照状态使用 store 引擎的纯数据词汇；派生层为成员查询构造临时 Set，且只有有序成员关系变化时才会更换数组引用。list 基线、unary 回声和 changed 帧都会整体替换集合。在 `workspace.list` 进行期间到达的较新回声或帧优先于旧基线。一条投影规则会清除刚被归档的当前 selection，同时覆盖本地操作、其他标签页和重连。
- 所有分组派生使用同一归档集合进行过滤，因此 workspace 分组、Ungrouped、搜索和平铺列表保持一致。会话菜单提供无需确认的非破坏性 **Archive**，以及需要确认的破坏性 **Delete conversation**。即使归档数量为零，已归档会话对话框仍可发现；它会标明每个会话所属的 workspace，并提供 Restore 或经确认的永久删除，失败操作会保留在界面中以便重试。
- `SessionPersistence.delete(id)` 是规范删除边界。`PersistenceCoordinator` 在进入 per-session 操作链前关闭准入，合并并发删除，等待 retirement 与先前写入，拒绝仍存活或不可处置的 prepared 身份，只调用一次 backend，然后使保留状态失效并安装进程内 tombstone。后续 append、prepare、inspect、load 或 create 不能排在删除之后并重建该 artifact。JSONL 会证明物理目标及父目录仍位于配置根目录内，拒绝 symlink/junction 目标，只验证有界 header（因此历史 body 损坏仍可删除），仅在 device/inode 身份一致时移除崩溃遗留的 POSIX staging hard link，只 unlink 精确的规范日志，并在 POSIX 上 fsync 父目录；所有上层目录都保持不变。SQLite 在一个事务中删除 session 行及其由外键级联删除的 events。
- `workspace.deleteSession` 在 Host gateway 中拥有跨 package 生命周期。它会在异步存在性发现之前安装删除 fence，并覆盖 public create 直到 Workspace attach、fork 直到 child attach、prompt 与 queue mutation、archive/restore/reorder、preset switch、普通 cold resume、Typert lookup，以及待处理的用户 question 或 approval。正在进行的 create、fork、resolver 和 preset 操作会被等待，并在异步边界之后重新检查 fence，不能晚到发布成功或重新插入 Workspace 记账。待处理的 question 与 approval 会在 teardown 等待之前被取消。gateway 自有的实时 Agent 会先被取消，等待 `whenIdle()`，再通过创建、fork 或恢复该 Agent 时捕获的准确 handle 执行 dispose。成功 teardown 期间会抑制普通 `host/session-removed`；若实际 detach 后删除失败，则会发布这一真实的非永久 frame，避免 client 保留幽灵 Agent。由配置或其他组件拥有的实时 Agent 会以 `agent-busy` 被拒绝，因为 gateway 无权将其 detach。
- 规范日志删除提交后，gateway 会幂等清除 session projection cache、session-query 的持久/实时索引行以及 message-feedback 行。随后 `WorkspaceRegistry.deleteSession(id)` 通过持久 `delete-session` pending marker，从每条 workspace 记录、全局归档集合与注册表索引中移除该 id；启动时会完成中断的注册表清理，而不是根据 table 形状猜测。只有这些 owner 都达到 absent 后置条件后，gateway 才发送 `host/session-deleted`；unary 响应与 Host 帧会从 client store 移除会话，而不会让更早的 disposal 帧过早呈现永久删除。
- 永久删除既不拥有 session `cwd`，也不拥有其中的任何文件。个人记忆保留在独立 owner 和生命周期中。不可变附件对象采用内容寻址，且可能被多个 session 引用，因此删除会随日志移除该会话的引用，但不会擦除共享附件对象或 request-image cache artifact。若以后加入引用感知垃圾回收，必须先证明没有任何剩余 owner 引用该对象，才能回收。

## 已考虑的替代方案

**把原 Delete 行仅作为归档，且不提供归档管理器。** 作为完整产品契约被否决：归档仍是安全默认动作，但隐藏会话需要可发现的恢复路径，用户也需要一个明确、经确认的会话历史销毁入口。

**per-workspace `archivedSessionIds`。** 否决，因为 Ungrouped 会话没有可持有该记录的 workspace 实体。

**在 `SessionSummary` 上增加 archived 标志。** 否决，因为它会把 workspace domain 事实 join 到 sessions domain 投影中，而 summary 仍需要单独的增量通知；跨域耦合成本高于省下一个字段的收益。

**在 Host 侧通过 `workspaceView` 或 `sessionIds` getter 过滤。** 否决，因为归档不改变记账，恢复还要求 client 保留完整 workspace 位置。

**增量归档帧。** 否决，因为集合很小且变化不频繁；完整快照无需 client 维护合并与去重状态，也与 workspace-changed 姿态一致。

**让 UI 或 `WorkspaceRegistry` 直接删除日志。** 否决，因为两者都无法使实时 Agent 静止、关闭 persistence 准入、清理可选 sidecar 或安排多 client 发布顺序。gateway 已经拥有 Agent handle 和 RPC 事务边界。

**递归删除 session 目录、workspace、记忆或附件。** 否决，因为 JSONL 只应拥有准确日志 artifact，workspace 包含用户文件，个人记忆刻意独立于 session，内容寻址附件也可能被共享。宽泛的文件系统删除还会在未证明所有权时跨越符号链接或 junction 边界。

**按 session id 强制 detach 任意实时 Agent。** 否决，因为外部 owner 可能有 gateway 无法观察的 teardown 义务；明确拒绝能保留其所有权契约。

## 后果

用户可以通过一个一致的生命周期隐藏、检查、恢复或永久删除会话；归档日志与 workspace 位置会一直持久保留到删除发生。永久删除刻意比「清除与此人或项目有关的一切」更窄：它会删除规范 session 历史以及 Leon 自有的 per-session 投影、索引、反馈、归档成员关系和 workspace 引用，但会保留项目目录、用户文件、个人记忆和共享不可变附件。

规范日志提交是不可逆点。sidecar 与注册表清理在其后执行，并保持可重试与幂等；如果该点之后失败，请求会返回错误，并暂不发送 `host/session-deleted`，直到重试完成 absent 后置条件。进程内 persistence tombstone 会阻止该进程中的身份复活，而重启后显式复用同一 id 属于一个新生命周期。若部署增加了其他 session 派生 owner，就必须先把它的 purge 加入 gateway 工作流，才能声称删除完整。

本实现假设只有一个 Leon Host 对 JSONL persistence root 拥有独占写权限。Node 没有可移植的 unlink-by-handle/unlinkat 原语，因此 backend 会在 pathname unlink 之前立即执行 containment 与 device/inode 复验，但无法消除最终 syscall 窗口中的恶意本地文件系统替换。gateway 目前也没有持久化的跨存储删除 journal：若在规范日志提交之后、所有 sidecar 与 Workspace 记账完成之前发生进程或断电故障，需要借助保留的 Workspace 引用显式重试。多进程 writer、对 persistence root 的敌意本地修改，以及覆盖所有派生存储的自动 crash recovery，仍属于部署加固工作，而不是此本地单用户生命周期的保证。

契约测试覆盖 JSONL 与 SQLite 的准确目标删除、并发操作顺序、tombstone 准入、归档/恢复持久性、中断的 workspace 清理、sidecar purge 串行化、gateway 自有实时 Agent teardown、外部 owner 拒绝、提交后的 Host 帧、client 回声/帧收敛、归档过滤、恢复错误以及经确认的删除。产品可见测试只对一次性 session 运行破坏性路径，并验证 workspace 目录仍然存在。
