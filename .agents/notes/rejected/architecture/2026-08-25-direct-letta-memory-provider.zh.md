# Agent Note: 直接 Letta 记忆 provider

Status: rejected — 当前 Letta Agent SDK 是另一个有状态 agent harness，并非可直接替换的带修订记忆 provider；旧版 V1 bridge 也无法满足 Leon 当前约定或可测量改进门禁

[English](2026-08-25-direct-letta-memory-provider.md) | 中文

## Problem

Leon 需要更丰富的长期 recall，但其记忆真源必须保留 workspace 所有权、精确修订冲突、时间历史、确定性遗忘、有界管理和 local-first 操作。外部记忆系统只有在不削弱这些保证的情况下改善检索，才有价值。

## Proposal

在 `ctx.memory` 后实现 `LettaMemoryProvider`，与 `LocalMemoryProvider` 比较，并且只有在它通过安全约定以及客观质量和延迟门槛时才迁移。

## Evaluation

本地 provider 在三次稳定运行中通过全部 31 个 LEON-EVAL-PTBR 场景，也通过记忆范围的全部 139 个测试。官方 Letta 项目已停止维护固定社区 MCP bridge 所面向的 V1 服务器。其受维护 Agent SDK 运行本地、云端或远程有状态 agent，并暴露不同的 agent、conversation、repository 和 git-backed 记忆模型。

评估的 Windows 部署中没有安装兼容的 Letta runtime 或端点。更重要的是，受维护 SDK 没有暴露 Leon 的精确 provider 操作、compare-and-set 和时间历史保证。因此，安装另一个 harness 只会测量另一个产品的启动与 agent loop，而不是证明其与 `MemoryProvider` 对等。

## Alternatives considered

**让 Letta 成为新的真源。**不采用，因为 Leon 的连续性将依赖第二个 runtime、发布节奏、schema、模型配置和数据位置，同时失去已经测试的 provider 保证。

**将旧 V1 MCP bridge 保留为可选工具。**仅作为已有 V1 0.16.x 部署的明确旧版互操作示例保留。它默认关闭，也不是 `MemoryProvider`。

**未来将当前 Letta Agent 用作专家 subagent。**作为独立实验暂缓。Agent 委派可能有价值，但不得静默拥有或改写 Leon 的持久记忆。

## Acceptance criteria

重新评估的适配器必须通过全部关键 LEON-EVAL 场景、将改写查询 recall 至少提高 10 个百分点、将检索 p95 保持在 2,000 ms 以内、保留修订与历史语义、不增加未经批准的云端或模型费用，并保持可选且以本地 provider 作为回滚路径。

## Risks

拒绝直接 provider 意味着 Leon 暂时放弃 Letta 的自主记忆重组。随着 Agent SDK 演进，此决定可能过时，因此未来实验前必须重新检查官方 API 和本地部署路径，不能依赖已退役的 V1 API。
