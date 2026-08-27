# Letta 记忆 provider 实验

[English](letta-memory-provider-experiment.md) | 中文

## 结论

Leon 不采用 Letta 作为 `MemoryProvider`。本地 provider 继续作为真源和交付默认值。这是一个已完成的不采用决定，而不是未完成的迁移。

## 基线

本地路径在三次稳定运行中通过全部 31 个 LEON-EVAL-PTBR 场景。Oracle precision 和 Recall@k 均为 100%，workspace、用户、敏感数据和云端泄漏均为零。记忆包范围也通过了 139 个测试。

## 兼容性门禁

| 要求 | 本地 provider | 当前 Letta 候选 |
|---|---|---|
| workspace 所有权记录 | 原生并封闭失败 | 必须由适配器重新设计 |
| 精确 compare-and-set 修订 | 原生 | Agent SDK 中没有对应约定 |
| 时间历史与替代关系 | 原生 | 使用不同的 git/block 记忆模型 |
| 有界管理列表 | 原生 | 使用不同的 agent/repository API |
| 创建、搜索、纠正、遗忘对等 | 完整 | 没有当前 provider 形态的 API |
| 无网络 I/O 的廉价 `available()` | 完整 | 需要另一个 runtime |
| 无额外模型或云端费用 | 完整 | 取决于所选 Letta backend |

官方 Letta 项目已停止维护 V1 服务器，并将活跃开发迁移到 Letta Agent 和 App Server。仓库中的社区 MCP 示例仅对现有 V1 0.16.x 部署仍有用途；它不会把 Letta 变成 Leon 记忆 provider，也不得连接到当前 App Server。

## 采用门槛

未来适配器只有满足以下条件，才有资格重新实验：

1. 通过全部关键 LEON-EVAL 隔离、隐私、同意和注入场景；
2. 相比本地基线，将改写查询 recall 至少提高 10 个百分点；
3. 在部署机器上将检索 p95 延迟保持在 2,000 ms 以内；
4. 保留修订冲突检测、时间历史和确定性删除；
5. 未经明确同意，不进行云端传输或计费模型调用；
6. 保持可选，并以 `LocalMemoryProvider` 作为回滚路径。

## 环境观察

评估时，此 Windows 部署没有 Letta CLI、Letta MCP bridge、Docker、Podman，也没有在 `127.0.0.1:8283` 响应的旧版端点。仅为制造 benchmark 而安装第二个 agent harness 无法证明 provider 兼容性，因此实验在传输记忆或添加全局依赖之前停止。

## 相关决定

- [提供方无关的 workspace 记忆](../../.agents/notes/implemented/architecture/2026-08-22-provider-neutral-workspace-memory.zh.md)
- [拒绝直接 Letta provider](../../.agents/notes/rejected/architecture/2026-08-25-direct-letta-memory-provider.zh.md)
- [LEON-EVAL-PTBR](leon-eval-ptbr.zh.md)
