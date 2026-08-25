# @deepseek-ai/dsh-memory-local

[English](README.md) | 中文

本包是 `ctx.memory` 的本地 Service Provider。它通过 `ctx.storageDomain` 打开版本化 `memory_local` domain，因此由部署选择的存储后端负责物理介质和持久性行为。

## 行为

- 记录以生成的 `MemoryId` 值作为键，并携带稳定的 `WorkspaceId` 所有权、会话来源、ISO 时间戳和用于比较并设置的 revision。
- 创建、纠正和遗忘操作会串行执行。持久写入落地后，操作才会完成。
- 搜索始终先按 workspace 过滤，之后才会排序或把候选文本发送给其他本地组件。每次请求仍会执行确定性的、忽略重音符号的词法匹配。
- 可选的混合检索通过回环地址上的 Ollama `/api/embed` 端点使用 `nomic-embed-text:latest`。查询和文档分别使用模型要求的 `search_query:` 与 `search_document:` 任务前缀，再按有界配置合并语义分数和词法分数。
- 语义文档向量仅保存在有界的进程内 LRU 缓存中。纠正或遗忘后会使对应缓存失效，重启后按需重建；持久记忆 schema 不发生变化。
- 本地超时、传输错误、无效响应或过大响应都会回退到词法结果。`memory/semantic-search` 事件只报告模式、数量、耗时、模型和清洗后的失败代码，不包含查询或记忆正文。
- 跨 workspace 的纠正和删除会返回与未知 id 相同的 `MEMORY_NOT_FOUND` 错误，因此不会在 workspace 之间泄露记录是否存在。

## 配置

`semanticSearch.enabled` 默认为 `false`。启用后，`baseUrl` 只接受 `127.0.0.1` 或 `::1` 上不带认证信息的 HTTP origin；提供方不会把记忆文本发送到远程 embedding 端点。模型必须预先安装在 Ollama 中，提供方绝不会自动下载模型。

Leon Web 的交付配置会保持该功能关闭，直到本地召回率和延迟通过验收。基线使用 256 维向量、最多 200 条经过 workspace 过滤的候选，以及最多 2,000 条缓存文档向量。

## 模型体验

通过 `@deepseek-ai/dsh-tool-memory` 间接影响；本提供方不注册工具或提示词段落。

#### KV Cache 影响

无。语义检索不会修改提示词或模型消息；只有选中的记忆记录之后可能影响 `@deepseek-ai/dsh-tool-memory` 组装的有界记忆上下文。

## 已知限制与暂缓事项

- 语义缓存是有界的线性重排序器，并非持久向量数据库或近似最近邻索引。模型冷启动明显慢于预热后的检索，大型 workspace 仍受 `maxCandidates` 约束。
- 本地测量取决于硬件。在 Leon 开发机上，一个包含 8 个输入、256 维的批次在模型冷启动时约耗时 7.7 秒，随后连续 4 次预热运行耗时 68.5–107.4 毫秒。这些数字是运维基线，不是可移植的性能承诺。
- domain 已做 schema 版本控制，但尚无迁移 runner；以后变更 schema 时必须提供显式迁移路径。
