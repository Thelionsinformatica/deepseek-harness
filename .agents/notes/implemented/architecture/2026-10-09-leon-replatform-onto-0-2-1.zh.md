# Agent Note: Leon 迁移到 DeepSeek Harness 0.2.1

Status: implemented

[English](2026-10-09-leon-replatform-onto-0-2-1.md) | 中文

## 问题

Leon 分支在 2026-08-21 从上游分出后不再跟进。到 2026-10-09，它比 `dsh-v0.2.1-alpha.2` 落后 8,258 个提交。直接合并产生 858 个冲突路径：582 个内容冲突、199 个修改/删除冲突和 70 个文件位置冲突。上游已经删除或移动了分支改动最多的大部分文件，包括承载 Leon 模型路由的 API 代理文件和客户端运行时文件，并移除了所有 Leon 包都依赖的运行时不变量插件。

## 决定

Leon 基于发布标签重建，而不是把上游合并进来。分支 `leon/replatform-0.2.1-alpha.2` 从 `dsh-v0.2.1-alpha.2` 开始，Leon 的工作分层移植：先移植 Leon 独有的包，然后是 Leon 预设和配置文件，最后逐个领域移植对上游文件的其余修改。上游已经满足其目的的修改会被放弃，而不是移植。之前的状态仍可从分支 `leon/self-improve-20260925` 和 `leon/wip-snapshot-20261009` 恢复。

移植的包会去掉 `invariant.ts` 入口，因为上游已移除该插件族，并采用上游的工作区约定。同步读取 Session 历史的移植插件会把这部分状态移入 Session 投影，遵循[同步读取弃用决定](2026-09-09-deprecate-synchronous-session-event-reads.zh.md)。第一个按此方式移植的包是 [`dsh-explicit-target-policy`](../../../../packages/guard/explicit-target-policy/README.zh.md)：`explicitTargetTurn` 投影折叠开放轮次中的直接人类文本、该插件自己的恢复通知以及其工具调用的绝对路径参数。插件注入的消息声明自己的 `MessageSourceMap` 类型，而不是已移除的通用 `plugin` 类型。

## 考虑过的替代方案

**合并上游并解决所有冲突。** 大多数冲突位于上游已删除或重构的代码中。解决它们会保留针对已不存在 API 的修改，所需时间也比移植更长。

**把选定的上游修复挑选到旧基线上。** 这会让 Leon 停留在旧版本，差距随每次上游发布而扩大。

**在移植的插件中保留已弃用的同步读取。** lint 检查会拒绝新的调用，而该决定的目的正是让 Session 历史无需常驻内存。

## 影响

- 在移植分支通过验证之前，Leon 部署继续运行旧构建；不会自动切换。
- 在所有层移植完成之前，移植分支缺少 Leon 的部分功能，例如记忆、知识库以及完成声明和失败恢复策略。
- 每个带投影的移植插件都拥有一个 `stateVersion`，当其折叠字段或折叠语义改变时必须更新。

## 验证

- `dsh-explicit-target-policy`：`vitest run packages/guard/explicit-target-policy` 通过 48 个测试，包括现在读取投影的同轮次重建和恢复计数测试；`tsc -b packages/guard/explicit-target-policy` 和暂存区 oxlint 配置均未报告错误。
