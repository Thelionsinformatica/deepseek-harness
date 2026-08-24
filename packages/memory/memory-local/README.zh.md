# @deepseek-ai/dsh-memory-local

[English](README.md) | 中文

本包是 `ctx.memory` 的本地 Service Provider。它通过 `ctx.storageDomain` 打开版本化 `memory_local` domain，因此由部署选择的存储后端负责物理介质和持久性行为。

## 行为

- 记录以生成的 `MemoryId` 值作为键，并携带稳定的 `WorkspaceId` 所有权、会话来源、ISO 时间戳和用于比较并设置的 revision。
- 创建、纠正和遗忘操作会串行执行。持久写入落地后，操作才会完成。
- 搜索会先按 workspace 过滤，再进行排序。首个实现采用确定性的、忽略重音符号的词法匹配，并对短语和查询词覆盖率评分。
- 跨 workspace 的纠正和删除会返回与未知 id 相同的 `MEMORY_NOT_FOUND` 错误，因此不会在 workspace 之间泄露记录是否存在。

## 模型体验

通过 `@deepseek-ai/dsh-tool-memory` 间接影响；本提供方不注册工具或提示词段落。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 词法排序刻意保持精简且不依赖额外组件。评估证明有必要后，embedding 检索可以成为另一个提供方或版本化的提供方实现。
- domain 已做 schema 版本控制，但尚无迁移 runner；以后变更 schema 时必须提供显式迁移路径。
