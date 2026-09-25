# Agent Note: 客户端领域图在 task-validation 节点上恢复合规

Status: implemented

[English](2026-09-25-client-domain-graph-task-validation.md) | 中文

## Problem

客户端领域图 gate 处于红色：`ui-conversation/src/client/chat/TaskValidationView.tsx` 从 `../conversation-nodes/task-validation.ts` 导入，形成了一条预算为零的兄弟领域边。这条边随 collective 功能的提交 `3592c8af11` 一起进入，而它一直没被发现，因为在对所有可执行 gate 做完整扫描之前，这个 gate 不在例行检查之内。

## Decision

task-validation 聊天节点的共享部分——`ValidationPhase`、`TaskValidationState` 以及纯辅助函数 `taskValidationPhase`——现在位于 `contract/chat-nodes.ts`，与其他聊天节点 payload 和纯辅助函数并列；视图与节点模块都改为从那里导入。`TaskValidationState` 声明为 `readonly`，与其新邻居保持一致。gate 脚本及其 legacy 预算未被改动：被禁止的边是被移除的，而不是被列入预算的。

## Alternatives considered

**把视图移入 `conversation-nodes/`** 会破坏该包的约定——所有注册在 `conversation.chat.node` 下的渲染器都位于 `chat/`——而且会要求修改客户端 slot catalog，超出这次修复的范围。

**新增一条 legacy 预算** 不是可行答案：预算是棘轮机制，新增的边会让 gate 失败，而 gate 自身的契约规定 legacy 边在被重构时只能减少、绝不放宽。为此边编预算等于保留违规。

**在两个领域里各复制一份辅助函数** 会重复一对契约层已经拥有的 payload 与辅助函数，并留下两份可以各自漂移的副本。

## Consequences

客户端领域图重新变绿：没有新增边，27 条锁定的 legacy 出现次数。task-validation 的 payload 现在与它的同类遵循同一套安排，因此后续读者看到的是一种模式，而不是一个例外。这次改动是位置迁移：辅助函数主体逐字节相同，`readonly` 在编译产物中被抹去，且没有任何位置给这些字段赋值。gate 仍然只能证明它所检查的内容——当禁止的边出现时它会失败，而无法证明别处不存在这类边。

## Testing

`verify-client-domain-graph` 退出码为 0；`vitest run packages/client/ui-conversation` 通过 32 个文件、512 项测试，其中包括 task-validation 的 spec，它同时演练 replay 与 live。类型等价性由模块解析与赋值点缺失推断得出；该轮未运行 typecheck。验证在本地完成：平台矩阵由 CI 负责。

## Related

[GUI web 客户端架构](../architecture/2026-07-19-gui-web-client-architecture.zh.md) 陈述了这次修复所恢复的分层规则。
