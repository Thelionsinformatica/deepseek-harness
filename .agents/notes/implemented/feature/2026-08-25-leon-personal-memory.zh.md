# Agent Note: Leon 跨 workspace 个人记忆

Status: implemented

[English](2026-08-25-leon-personal-memory.md) | 中文

## 问题

Leon 只能在当前项目 workspace 内保留持久事实。这种隔离保护了项目，但当工作转到另一个 workspace 时，用户必须重复稳定偏好、常用设备与软件、别名、例行流程以及非敏感操作上下文。把这些事实当作项目记录，要么会失去连续性，要么会故意把一个项目的数据泄漏到另一个项目。

## 决策

Leon 拥有独立的 `ctx.personalMemory` 服务，以及自己的提供方注册表、`PersonalMemoryOwnerId` 作用域、生命周期、操作事件和提供方约定。Web host 选择本地提供方并把数据存入专用 `personal_memory_local` domain；workspace 记忆继续使用 `memory_local`。本地适配器复用已验证的串行 revision 与比较并设置引擎，但绝不会把内部的分区键作为 workspace 公开。

Leon preset 指定一个显式本地所有者分区。当该分区和服务存在时，`dsh-tool-memory` 会增加 `personal_memory_remember`、`personal_memory_search`、`personal_memory_update` 和 `personal_memory_forget`。首步个人回忆使用与 workspace 回忆相同的记录数与字符数边界，把每个快照标记为没有指令权限的不可信数据，并在可选检索不可用时开放失败。

个人写入要求明确的记住意图，或已经清楚确认的持久事实。提供方中立服务会在提供方执行前拒绝类似凭据的内容，因此其他 Consumer 不能绕过模型工具的过滤。共享检测器覆盖常见 API key、access token、private key、密码、JWT 和云凭据，但不声称是完整的数据防泄漏系统。

匿名遥测关联 id 与个人所有权保持无关。它不会被复用或提升为 `PersonalMemoryOwnerId`。交付的单用户标签是显式部署配置，并不意味着经过身份验证的账户。

## 验证

运行时测试覆盖规范化、提供方选择、安全事件元数据、验证以及在提供方写入前拒绝。对于本地提供方，测试覆盖重启持久性、跨所有者隔离、分离的存储 domain、revision 历史、陈旧 revision、纠正和遗忘。真实 agent loop 证明一个会话可以保存个人偏好，而另一个已注册 workspace 中的会话可通过有界自动回忆获得该偏好。Loader 组合测试通过 Web 产品使用的同一插件机制启动服务与提供方。

## 考虑过的替代方案

- **使用一个隐藏 workspace 作为全局记忆**：拒绝，因为合成项目会掩盖权限边界、把 workspace 概念泄漏到公开 API，并让项目管理意外治理个人事实。
- **复用匿名遥测 id 作为所有者身份**：拒绝，因为该值是可重置的关联 id，不是经过身份验证的人员或授权决定。
- **把 `MemoryScope` 扩展为 workspace 或个人 union**：拒绝，因为一个提供方注册表和一个存储 domain 会增加意外跨作用域路由的可能性，并使回滚更复杂。分离服务让生命周期和提供方选择保持独立。
- **采用 Letta 作为个人存储**：本次增量拒绝，因为当前 Letta Agent SDK 是完整的有状态 agent runtime，而不是 Leon 精确 revision CRUD 约定的即插即用等价物。本地提供方保持确定性且不需要密钥。
- **从每段对话自动存储个人事实**：拒绝，因为随意陈述、secret 与纠正需要显式用户权限。自动回忆已启用；自动持久写入没有启用。

## 后果

Leon 可以在项目之间携带显式个人偏好和常用本地上下文，而不会削弱 workspace 隔离或依赖远程 API。更换模型不会删除这些记录，因为记忆位于提供方拥有的本地 domain。只有配置个人所有者后，额外工具 schema 与提示词段落才会出现。

本次增量不提供经过身份验证的多用户所有权、静态加密、浏览器管理界面、个人语义检索或通用 secret 检测器。本地文件继承已配置存储后端与操作系统保护。后续 UI 必须提供查询、纠正、删除、禁用和备份，同时不合并个人与项目记录。
