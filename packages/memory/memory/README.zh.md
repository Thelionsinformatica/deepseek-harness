# @deepseek-ai/dsh-memory

[English](README.md) | 中文

`MemoryRuntime`（`ctx.memory`）是持久长期记忆的 Service Definition。它使产品约定不依赖 Letta、本地 JSON 介质或以后采用的任何向量数据库。

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-memory` | Service Definition：规范化记录、workspace 范围、提供方选择、revision 检查和错误 |
| `@deepseek-ai/dsh-memory-local` | Service Provider：通过 `ctx.storageDomain` 提供本地持久记录和词法检索 |
| `@deepseek-ai/dsh-tool-memory` | Consumer：面向模型的显式创建、搜索、纠正和遗忘控制 |

## 服务 API

每项操作都携带稳定的 `WorkspaceId`；原始路径绝不作为所有权键。`create()` 存储规范化内容和来源，还可存储从零到一的 importance、confidence 信号、`explicit` 或 `reviewed` 确认类别，以及可选的激活或过期时间戳。旧记录可以不包含这些字段。`search()` 返回有界的提供方排序结果，并默认请求活动记录；`includeHistory` 会明确要求提供方同时返回非活动修订。管理用的 `list()` 操作会返回有界分页，并按生命周期状态和可选文本筛选；时间历史始终限定在请求的 workspace 内。`update()` 纠正一个精确 revision，`forget()` 删除一个精确 revision。纠正和删除使用 `{ id, revision }`，因此模型上下文中的陈旧内容无法覆盖较新的事实。

记录 schema V2 增加 `validFrom`、`validUntil`、`expiresAt`、`supersedes` 和 `supersededBy`。该约定仍接受 schema V1 记录。历史保留方式与物理布局由提供方负责；随产品提供的本地提供方会原子保留修订，而不是静默覆盖。

提供方选择发生在执行时，且不依赖注册顺序。显式 `provider` 必须已注册且可用。未指定时必须恰好只有一个可用提供方；没有或存在多个可用提供方都会通过结构化 `MemoryError` code 失败。

## 模型体验

通过 `@deepseek-ai/dsh-tool-memory` 等 Consumer 间接影响。本包不提供工具、提示词文本或自动对话捕获。管理列表属于 Host/UI 能力，不会扩展面向模型的工具 API。

#### KV Cache 影响

不会直接导致 KV Cache 失效。任何面向模型的 schema 或提示词变更均由 Consumer 负责。

## 已知限制与暂缓事项

- 第一版约定只支持 workspace 范围；用户全局范围和组织范围会暂缓到其权限规则明确之后。
- 提供方导入来源和 embedding 暂缓。规范化 API 可以在不改变记忆所有权的前提下增加这些内容。
- 历史搜索是显式审计操作。自动回忆始终只使用活动记录，并限定于 workspace。
- 服务不决定哪些信息值得保留。该策略属于 Consumer。
