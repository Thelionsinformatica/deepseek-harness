# Agent Note：可选的本地混合记忆检索

状态：已实现

[English](2026-08-25-local-hybrid-memory-retrieval.md) | 中文

## 问题

确定性的词法提供方能够保持 workspace 隔离，并且不依赖其他模型，但当查询使用不同词汇表达同一事实时，无法稳定召回。强制使用远程 embedding 服务会削弱 Leon 的本地优先边界；在迁移方案完成之前持久保存向量，也会增加不必要的恢复风险。

## 决策

- 扩展现有提供方并增加可选混合层，而不是增加第二个持久提供方或修改记忆 schema。
- 通过 Ollama 的 `/api/embed` 端点使用 `nomic-embed-text:latest`。遵循模型约定：查询添加 `search_query:` 前缀，文档添加 `search_document:` 前缀。
- 只接受 `127.0.0.1` 或 `::1` 上不带认证信息的 HTTP origin。在任何候选文本发送到 Ollama 前，先过滤 workspace 并限制候选数量。
- 每次请求都保留词法检索。合并语义与词法分数，对仅语义命中的结果要求最低分数，并在超时、传输、HTTP、验证或响应大小错误时返回词法结果。
- 文档向量保存在有界的进程内 LRU 缓存中，以记忆 id 和 revision 作为键。纠正或遗忘后使缓存失效，重启后按需重建。
- 发出不含正文的 `memory/semantic-search` 事件，只包含数量、耗时、所选模型、模式和清洗后的失败代码。
- 交付配置保持 `semanticSearch.enabled: false`。提供方绝不会自动下载模型。

实现遵循官方 [Nomic Embed 模型约定](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)和 [Ollama embedding API](https://docs.ollama.com/api/embed)。

## 验证

测试证明了不同词汇表达同一含义时的召回、embedding 前强制 workspace 过滤、revision 缓存失效、有界 LRU 行为、确定性词法回退、取消传播、响应大小限制、严格回环配置和清洗后的遥测。真实 Cordis Loader 组合能够启动可选功能并召回改写后的查询。提供方的两个测试文件共通过 56 个用例，statement、branch、function 和 line 覆盖率均为 100%；全部 7 个记忆 suite 共通过 96 个用例。仓库级 `check:all` 在 741.95 秒内通过全部 48 个门禁，没有失败或跳过项。

在 Leon 开发机上，一个包含 8 个输入、256 维的真实批次在模型冷启动后约耗时 7.7 秒，随后连续 4 次预热运行耗时 68.5–107.4 毫秒。该测量说明功能应继续保持选择加入，直到 LEON-EVAL-PTBR 在有代表性的葡萄牙语任务上证明召回收益。

## 已考虑的替代方案

**远程 embedding API。** 初始实现拒绝该方案，因为记忆文本会越过本地边界，并引入凭据、成本和可用性依赖。

**持久向量数据库。** 暂缓，因为当前有界候选集尚不足以证明迁移、备份、恢复和索引重建复杂度是合理的。

**仅语义检索。** 拒绝，因为它会让可选本地模型成为单点故障，并削弱确定性的精确召回。

**自动下载模型。** 拒绝，因为安装会修改机器、消耗存储与带宽，必须保持为操作员的显式动作。

## 后果

Leon 现在能够独立于对话模型召回同义的项目记忆，因此可以在 Qwen、Ornith、Gemini 或 OpenAI 之间切换，而无需丢弃持久知识接缝。该功能保持本地、可逆，并按 workspace 隔离。冷启动延迟和线性候选重排序仍是真实成本；是否在产品中启用，必须通过 LEON-EVAL-PTBR 门禁，而不是依赖架构假设。
