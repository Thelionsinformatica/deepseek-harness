---
description: "Leon 工作区记忆与个人记忆的包地图：服务定义、本地提供方、连续性快照以及面向模型的工具，供组合 Leon 记忆的用户与维护者阅读。"
kind: "package-group"
---

# memory/ — Leon 长期记忆

[English](README.md) | 中文

## 概述

`memory/` 组为 Leon 提供持久的项目事实和独立作用域的个人事实，同时不把产品绑定到某一种记忆引擎。工作区记忆和个人记忆各有一个与提供方无关的服务定义，以及位于独立存储领域的本地提供方。`tool-memory` 是两者面向模型的消费方：显式的记住、搜索、纠正与遗忘工具，有界的自动回忆，经人工审核的候选队列，以及经审核的流程学习。这些包都不属于 `dsh` 基础组合包；由 Leon 组合挂载。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 提供什么 |
|---|---|
| [`memory/`](memory/README.zh.md) | `ctx.memory`：工作区范围记录、精确修订纠正、提供方选择 |
| [`memory-local/`](memory-local/README.zh.md) | 本地 `ctx.memory` 提供方，带时间修订、词法检索和可选的本机语义检索 |
| [`memory-continuity/`](memory-continuity/README.zh.md) | 本地记忆记录的带校验快照与幂等恢复 |
| [`personal-memory/`](personal-memory/README.zh.md) | `ctx.personalMemory`：按所有者划分的个人事实，带实时启用偏好 |
| [`personal-memory-local/`](personal-memory-local/README.zh.md) | 使用独立存储领域的本地 `ctx.personalMemory` 提供方 |
| [`tool-memory/`](tool-memory/README.zh.md) | 模型工具、自动回忆、候选审核、管理和流程学习 |

-----

<a id="related-documentation"></a>
## 相关文档

- [记忆子系统参考](../../docs/subsystems/memory.zh.md) — 所有权、隔离、记录词汇以及生成的服务 API。
- [Leon 迁移 Agent Note](../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.zh.md) — 这些包如何迁移到 DeepSeek Harness 0.2.1。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
