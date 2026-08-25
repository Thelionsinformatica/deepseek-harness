# @deepseek-ai/dsh-memory-local

[English](README.md) | 中文

本包是 `ctx.memory` 的本地 Service Provider。它通过 `ctx.storageDomain` 打开版本化 `memory_local` domain，因此由部署选择的存储后端负责物理介质和持久性行为。

## 行为

- 记录以生成的 `MemoryId` 值作为键，并携带稳定的 `WorkspaceId` 所有权、会话来源、ISO 时间戳、用于比较并设置的 revision，以及创建时提供的可选 importance、confidence、确认与时间元数据。
- 创建、纠正和遗忘操作会串行执行。在默认的 `temporal-v2` 模式下，一次纠正会在同一个谱系值中原子写入新的当前修订与不可变的先前修订。持久写入落地后，操作才会完成。
- 活动搜索会先按 workspace 与评估时间过滤，之后才会排序或把候选文本发送给其他本地组件。默认不返回尚未生效、已过期或已被替代的修订。`includeHistory: true` 通过确定性词法搜索返回有效的审计修订；历史文本不会发送到语义索引。
- 未来生效的纠正会让先前修订持续有效到新修订的 `validFrom`；立即纠正则会在转换时刻结束先前修订。
- 可选的混合检索通过回环地址上的 Ollama `/api/embed` 端点使用 `nomic-embed-text:latest`。查询和文档分别使用模型要求的 `search_query:` 与 `search_document:` 任务前缀，再按有界配置合并语义分数和词法分数。
- 语义文档向量仅保存在有界的进程内 LRU 缓存中。纠正或遗忘后会使对应缓存失效，重启后按需重建；持久记忆 schema 不发生变化。
- 本地超时、传输错误、无效响应或过大响应都会回退到词法结果。`memory/semantic-search` 事件只报告模式、数量、耗时、模型和清洗后的失败代码，不包含查询或记忆正文。
- 跨 workspace 的纠正和删除会返回与未知 id 相同的 `MEMORY_NOT_FOUND` 错误，因此不会在 workspace 之间泄露记录是否存在。

## 配置

`historyMode` 默认为 `temporal-v2`。只有在紧急回滚时才将其设为 `v1`：新的纠正会恢复原位覆盖，并且不再添加历史。已有 V2 记录仍可读取，活动搜索的有效期与过期过滤也会继续执行。

`semanticSearch.enabled` 默认为 `false`。启用后，`baseUrl` 只接受 `127.0.0.1` 或 `::1` 上不带认证信息的 HTTP origin；提供方不会把记忆文本发送到远程 embedding 端点。模型必须预先安装在 Ollama 中，提供方绝不会自动下载模型。

Leon Web 的交付配置会保持该功能关闭，直到本地召回率和延迟通过验收。基线使用 256 维向量、最多 200 条经过 workspace 过滤的候选，以及最多 2,000 条缓存文档向量。

## 模型体验

通过 `@deepseek-ai/dsh-tool-memory` 间接影响；本提供方不注册工具或提示词段落。

#### KV Cache 影响

无。语义检索不会修改提示词或模型消息；只有选中的记忆记录之后可能影响 `@deepseek-ai/dsh-tool-memory` 组装的有界记忆上下文。

## 已知限制与暂缓事项

- 语义缓存是有界的线性重排序器，并非持久向量数据库或近似最近邻索引。模型冷启动明显慢于预热后的检索，大型 workspace 仍受 `maxCandidates` 约束。
- 本地测量取决于硬件。在 Leon 开发机上，一个包含 8 个输入、256 维的批次在模型冷启动时约耗时 7.7 秒，随后连续 4 次预热运行耗时 68.5–107.4 毫秒。这些数字是运维基线，不是可移植的性能承诺。
- Schema V2 字段与嵌套历史均为可选，因此旧 V1 值无需物理迁移即可继续读取。该 domain 仍没有通用迁移 runner；未来不兼容的 schema 变更必须提供显式迁移路径。
