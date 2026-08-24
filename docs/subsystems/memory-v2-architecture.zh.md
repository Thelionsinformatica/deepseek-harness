# 记忆 V2 — 参考架构

[English](memory-v2-architecture.md) | 中文

目标：在不改变 Leon 身份所有权且不强制依赖外部服务的前提下，以安全、可控的方式改善连续性。

## 1) 当前架构图（已批准）

```text
User
 └─ Prompt
    └─ Preset Leon
       ├─ tool-memory (consumer explícito + recall read-only)
       └─ agentes de execução (DSH agent loop)
    └─ Host
       ├─ ctx.memory (MemoryRuntime)
       ├─ memory-local (provider local por workspace)
       └─ workspaceRegistry
```

当前实现：

- `ctx.memory`：提供方中立的接缝。
- `memory-local`：由存储域支持的本地提供方。
- `tool-memory`：显式工具，加上可选的自动回忆，并以影子模式持久化候选项供审查。
- `ctx.workspaceRegistry`：根据 `cwd` 解析工作区。

## 2) V2 目标架构

### 必需层

1. **工作记忆**
   - 当前会话上下文；不会跨会话持久化。
2. **持久记忆**
   - 稳定的事实、决策、偏好与配置。
3. **知识/RAG 层**
   - 用于补充检索的项目与文档内容。
4. **记忆事件日志**
   - 创建、更新、遗忘与纠正的决策轨迹。

### V2 运行时

- **MemoryCandidateExtractor**
  - 读取消息，但暂不存储。
  - 发出包含 `category`、`confidence`、`importance`、`scopeCandidate` 与 `sensitivity` 的候选项。
  - 不更改记忆；只生成追踪记录。
- **MemoryPolicyEngine**
  - 应用确定性规则：绝对阻止、确认、自动存储或拒绝。
- **ShadowStore**
  - 持久化候选项以供用户审查，但暂不影响响应。
- **MemoryDecisionQueue**
  - 保存待处理候选项及其决策轨迹。
- **MemoryPolicyVersion**
  - 用于回滚与历史追踪的数字版本。

### 与当前组合的集成

- `tool-memory` 继续作为 `ctx.memory` API 的消费方。
- `MemoryRuntime` 继续作为提供方中立的约定。
- 当前的 `automaticRecall` 在 V2 中成为初始读取与上下文准备阶段，不执行变更。

## 3) 与当前代码兼容的演进点

- 在宿主组合中引入 `MemoryExtractor` 与 `MemoryPolicyService` 作为并行服务。
- 使用可选的 `schemaVersion` 与来源元数据强化 `@deepseek-ai/dsh-memory` 类型，同时不破坏旧约定。
- 保持当前 `local` 提供方为默认值，仅在收益得到证明后添加 `local-semantic` 或未来提供方。

## 4) 范围限制（不可协商）

- 个人记忆与文档 RAG 不得直接合并为同一状态。
- 检索绝不能跨越工作区边界。
- 自动写入语义必须先经过确定性策略，并在必要时取得用户授权。
- 记忆服务不得更改 Leon 的身份、名称或声音。

## 5) 建议顺序

`baseline → observability → shadow mode → policy → controlled automatic storage → hybrid retrieval → safe context → LEON-EVAL → optional provider`
