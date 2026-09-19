# Agent Note: 下一项人类直接任务开始时清空 todo 计划条

Status: implemented

[English](2026-07-28-todo-plan-clears-on-next-turn.md) | 中文

## 问题

`todo_write` 在会话日志中存储完整列表快照，交互式宿主把最新列表渲染为计划条。已完成或已放弃的清单不得泄漏到用户提出的下一项任务。但是，长时间运行的 goal 会故意跨越多个自动轮次；若在每次 `turn/start` 清空清单，同一项任务会在继续执行的 Round 之间看似消失，也会移除拒绝过早完成所需的证据。

## 决策

常驻计划是其后没有更晚人类直接 `user/message`（`source.kind === 'user'`）的最近一次 `todo/write`。`turn/start`、`turn/end` 以及 goal 或插件来源的消息都会保留列表。新的用户请求会在模型写入替代计划之前清空上一项任务，而每个自动 Goal Round 都会看到并更新同一目标的一份连续计划。

### 宿主投影（web）

`dsh-tool-todo` 的 `todos` 投影单元折叠该规则：`apply` 从每个 `todo/write` 取完整列表，只在之后的人类直接 `user/message` 上返回 `null`（`stateVersion` 3）。载体（`dsh-host-apiproxy`）在历史记录尾部的 `projections` 块中提供该值，并以 `session/projection` 帧推送；web dock 经 `useProjection('todos')` 读取。

### TUI 实时路径

原 TUI 使用较早的轮次边界规则，该包其后已被移除（[移除 TUI 包](../simplification/2026-08-04-remove-tui-package.zh.md)）。目前权威的产品路径是由 Web dock 消费的宿主投影。

## 考虑过的替代方案

- **在每个 `turn/start` 清空**——已否决，因为自动 Goal Round 对同一任务而言也是一个新轮次；Leon 继续工作时计划反而会消失。
- **在 `turn/end` 清空**——用户仍在阅读刚完成的回答时就隐藏清单；此时计划条的职责是已完成计划，而非空 dock。
- **仅在全部项为 `completed` 时清空**——会让放弃或部分完成的计划跨轮次残留；计划条仍会显示另一任务的工作。
- **在人类输入时追加空的 `todo/write`**——为 UI 生命周期规则改写日志，并捏造模型从未写出的写入。

## 后果

重新打开会话时，同一任务的所有自动 Round 会恢复一份计划。下一项人类直接请求会在新工作开始前退役该计划。事件溯源与 last-write-wins 替换仍归 [web todo 展示](2026-07-23-web-todo-display.zh.md)和 [`todo_write` 工具](2026-06-29-todo-write-tool.zh.md)所有；本 Agent Note 拥有人类直接边界。投影测试固定自动轮次保留、插件消息保留、人类直接清空，以及使旧规则下缓存状态失效的版本递增。
