# @deepseek-ai/dsh-personal-memory-local

[English](README.md) | 中文

本包是 `ctx.personalMemory` 的本地提供方。它打开版本化的 `personal_memory_local` 存储 domain，该 domain 与 workspace 记忆的 `memory_local` 物理分离；它复用已经验证的本地 revision 引擎，但不会公开内部的分区键。

## 行为

- 每个本地所有者映射到专用个人记忆 domain 中的一个内部分区。公开记录只返回 `PersonalMemoryScope`；合成的 workspace 标识绝不会越过提供方边界。
- 创建、纠正和遗忘操作保持串行。`temporal-v2` 会原子保留先前 revision，并要求比较并设置引用。
- 搜索和列出绝不会返回另一个所有者分区。跨所有者的纠正和删除会变成 `PERSONAL_MEMORY_NOT_FOUND`，从而隐藏该 id 是否存在于其他位置。
- 提供方采用确定性的大小写与重音不敏感词法检索，并通过选定的 `ctx.storageDomain` 后端跨进程重启保留数据。

## 配置

`historyMode` 默认为 `temporal-v2`。`v1` 是恢复原位纠正的紧急回滚；它不会合并个人与 workspace domain。

## 模型体验

通过 `@deepseek-ai/dsh-tool-memory` 间接呈现；本提供方不增加 schema 或提示词文本。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 本次增量未为个人记忆启用语义检索；确定性词法检索是基线。
- 静态加密依赖未来的加密存储后端或操作系统卷保护。
- 删除已配置的存储目录会删除个人记忆；备份与恢复必须包含 `personal_memory_local` domain。
