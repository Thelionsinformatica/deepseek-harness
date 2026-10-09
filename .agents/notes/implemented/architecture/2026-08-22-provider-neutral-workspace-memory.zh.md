# Agent Note: 提供方无关的 workspace 记忆与首个本地提供方

Status: implemented

[English](2026-08-22-provider-neutral-workspace-memory.md) | 中文

## 问题

Leon 需要能跨会话和上下文压缩（context compaction）保留的持久记忆，但如果把 Letta、某一种向量数据库或原始对话日志作为产品真源，身份和连续性就会绑定到外部实现。记忆还会形成权限边界：为一个项目保留的事实禁止出现在另一个 workspace 中，模型上下文中的陈旧内容也禁止覆盖较新的纠正。

## 决策

- **Leon 拥有提供方无关的记忆能力 seam。**`@deepseek-ai/dsh-memory` 发布 `ctx.memory`、规范化请求和记录类型、执行时提供方选择、边界限制以及结构化错误。提供方注册能力，而不是工具。Letta 以后可以实现相同的 `MemoryProvider` 约定，无需改变面向模型的 API，也不会成为 Leon 身份的所有者。
- **Workspace 身份是第一版唯一发布的范围。**每项操作都携带稳定的 `WorkspaceId`；原始路径在执行时由 `ctx.workspaceRegistry` 解析，绝不成为持久所有权键。搜索在排序前按 workspace 过滤，跨 workspace 变更与未知 id 返回相同的未找到结果，因此不会泄露记录是否存在。
- **本地提供方是第一个持久实现。**`@deepseek-ai/dsh-memory-local` 拥有版本化 `memory_local` 存储 domain，并使用已经选定的 `ctx.storageDomain` 后端。它存储会话来源、ISO 时间戳和单调递增的 revision。变更操作会串行执行，而且 storage-domain 的持久性边界落地后，操作才会完成。
- **纠正和删除使用比较并设置引用。**搜索返回 `{ id, revision }`；更新和遗忘需要该精确组合。陈旧 revision 会通过 `MEMORY_REVISION_CONFLICT` 失败，而不会静默替换较新的状态。
- **第一阶段采用显式保留策略。**`@deepseek-ai/dsh-tool-memory` 只在记忆和 workspace 服务同时存在时提供 `memory_remember`、`memory_search`、`memory_update` 和 `memory_forget`。其策略禁止存储身份验证 secret，并且只允许为显式记忆意图或清楚确认的持久事实执行写入。它不会自动把对话历史复制到长期记忆。
- **Web profile 选择本地提供方，而 Leon preset 只拥有 Consumer。**宿主使用 `provider: local` 挂载 seam 和本地提供方。preset 的可选 Consumer 在这些宿主服务存在时激活，因此在没有记忆能力的 headless profile 中组合 Leon 不会发布损坏的工具。

## 验证

记忆 seam 测试固定提供方选择、歧义、重复 id、输入规范化、结果上限和取消转发。本地提供方测试固定创建、忽略重音符号的搜索、纠正、陈旧 revision 拒绝、删除、持久重新打开、写入失败隔离以及 workspace 隔离。一项无需密钥的真实 agent loop 集成会启动存储、workspace、记忆、本地提供方和 4 个工具；脚本化模型会保留并检索一项事实，同时对生成的工具目录做快照，全程不使用任何外部 API key。

## 考虑过的替代方案

- **把 Letta 作为核心记忆服务**：拒绝，因为其服务器生命周期、数据模型和发布节奏会成为 Leon 的连续性边界。Letta 仍是稳定约定背后的候选 Service Provider。
- **把会话事件日志作为长期记忆**：拒绝，因为日志是对话证据，而不是经过筛选的事实存储；压缩会改变模型可见历史，而且跨会话检索具有不同的保留和权限要求。
- **以原始 workspace 路径作为记忆键**：拒绝，因为别名、符号链接、规范化和目录移动会使路径成为不稳定引用。现有 workspace 注册表已经提供持久 id。
- **自动保留每个对话轮次**：拒绝，因为这会带来无法控制的隐私、质量和删除问题。显式选择性保留是安全的第一版策略；自动提取需要以后经过评估的权限和脱敏设计。
- **立即安装 embedding 和向量数据库**：拒绝，因为初始本地语料规模很小，而词法检索无需密钥、具有确定性且可以测试。检索质量评估应当先证明增加运维栈的必要性，再让它成为依赖。

## 后果

Leon 现在拥有独立于任何模型的持久项目记忆，并且可以在更换提供方后继续使用。本地路径不增加 API key、服务进程、Docker 依赖或外部数据传输；workspace 隔离和 revision 会对两个风险最高的数据损坏路径采用封闭失败。第一个提供方有意保持词法检索。后续决策在不改变本所有权约定的前提下加入了有界、只读的自动回忆；参见[受控自动回忆](2026-08-22-controlled-automatic-memory-recall.zh.md)。全局记忆、embedding、导入的 Letta 来源、schema 迁移工具和 Letta 提供方仍属于后续工作。
