# Agent Note：受控写入已审查的最终记忆

状态：已实现

[English](2026-08-25-controlled-reviewed-memory-write.md) | 中文

## 问题

候选项面板可以记录人工决定，却无法把已批准候选项提升为与提供方无关的持久记忆。自动写入每个 `store` 建议会绕过操作员，而单一全局开关会让一个 workspace 或本地所有者的批准授权其他范围。提供方或 journal 失败还可能造成无法追踪或重复的写入。

## 决策

- 人工 `accept` 仍是强制条件。`reject` 和 `ignore` 永远不会写入记忆。
- 受控持久化归 Host 审查服务所有；规范候选记录、已解析 workspace、已配置本地所有者和 `ctx.memory` 接口都在这里同时可用。
- 随产品提供的 Web 组合把 `automaticWrite` 设为 false，并使用空允许列表。写入同时要求总开关开启、候选项的精确 `workspaceId` 位于 `automaticWriteWorkspaceIds`，以及候选项的精确 `userId` 位于 `automaticWriteUserIds`。
- 只有确定性决策为 `store` 的非敏感候选项才能调用 `ctx.memory.create()`。批准 `shadow` 或 `confirm` 仍只记录审查，不执行最终存储。
- 候选记录就是决策 journal。它记录 `skipped`、`writing`、`stored` 或 `failed`、稳定原因和时间戳。成功写入还会记录记忆 ID 与修订号。
- 在提供方变更之前持久记录 `writing`。提供方失败会变为 `failed`，并让候选项保持未审查以便重试。如果写入尝试后的 journal 最终状态不确定，`writing` 状态会拒绝自动重试，从而避免服务静默创建重复记忆。
- 重复已经成功完成的批准具有幂等性，并返回原始存储追踪。

## 验证

Host 集成覆盖证明了默认关闭、用户与 workspace 累积授权、非 `store` 决策不会自动持久化、已审查写入成功、持久追踪字段、重复幂等性、提供方失败恢复，以及拒绝重复结果不确定的 `writing` journal。浏览器覆盖证明了仅记录决定与已经本地存储两种不同反馈。聚焦运行通过了 25 个测试，仓库级 `check:all` 运行通过了全部 48 个门禁，没有跳过任何门禁。该实现不改变模型提示词、工具结果、Gemini 凭据或跨 workspace 检索。

## 已考虑的替代方案

**直接从提取策略写入。** 已拒绝，因为 `store` 是建议而不是同意，而且提取发生在用户检查候选项之前。

**使用单一全局自动写入开关。** 已拒绝，因为它无法表达用户与 workspace 隔离，并会让回滚范围不必要地扩大。

**重试每个未完成 journal 状态。** 已拒绝，因为记忆提供方提交后，进程仍可能丢失最终 journal 更新。重试结果不确定的 `writing` 状态可能重复创建持久记忆。

## 后果

Leon 现在可以把明确批准、安全且高置信度的候选项转为本地持久记忆，而无需把该功能耦合到 Ollama、Gemini、OpenAI 或其他模型。随产品提供的组合仍保持关闭，直到操作员明确启用一个精确用户与 workspace。当前 UI 会报告结果，但尚不能编辑这些允许列表；配置仍是 Host 所有的运维控制。
