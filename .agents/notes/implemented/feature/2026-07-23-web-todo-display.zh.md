# Agent Note: Web todo 展示——快照副作用通道 + 两个渲染面

Status: implemented

[English](2026-07-23-web-todo-display.md) | 中文

## 问题

`todo_write` 把 `todo/write` 的整份列表快照追加进会话日志；TUI 渲染一块常驻的 plan 面板（自动化专用的 ACP（Agent Client Protocol）桥接刻意不做 todo 呈现）。Web 客户端把这个事件整个丢弃了：host mux 流本已转发每一个会话事件，但 `todo/write` 不是 surface 类型（它从不 fold 进 `ConversationSnapshot.nodes`），也没有任何副作用分支累积它——浏览器既无消费点，也无展示面。

## 决策

把 `todo/write` 当作会话副作用消费，而非 surface 节点，并在两个面上渲染它，这两个面正对应 TUI 已经绘制的那套划分。

### 宿主投影，与回放收敛

`dsh-tool-todo` 注册 `todos` 会话投影：整份列表的 `todo/write` 事件采用后写覆盖先写，自动消息保留该值，下一条人类直接 `user/message` 将其清空（[按任务界定的计划生命周期](2026-07-28-todo-plan-clears-on-next-turn.zh.md)）。Host 在尾页投影基线与 `session/projection` 推送帧中提供这一权威值。客户端投影存储会播种并更新同一 key，因此回滚、重连和冷回放无需在 conversation 包中重建领域规则即可收敛。这遵循事件自身的约定（「仅存在于日志中的 UI 状态；绝不纳入派生历史」）：把每次写入作为对话节点呈现，会让已被取代的列表看起来仍然有效。

### TodoPanel：持久化列表作为一条常驻横条

面板经 `conversation.input.dock` slot 挂载（普通注册者插件 `todoDockEntry` 使用 `ctx.slots.inject`，不依赖 `ConversationController`，`order: 0` 排在队列条上方），空列表时隐藏，并可折叠。表头把所属会话的 running 位与列表状态组合成一项明确事实——正在工作、已停止但工作未完成，或已完成——再附上以 `·` 连接的各状态计数。状态图标为 figma todo 套件（绿色勾选环／蓝色渐隐环／虚线未开始环），卡片使用 tip 表面（`--dsw-specific-tip`、14px 圆角、`width: calc(100% - 88px)`／`max-width: 776px` 居中；InputBar 顶部 6px 内边距是到输入卡的间距）。它经标准件 `useProjection` hook 读取 host 计算的 `todos` 投影，并通过 `useSession` 读取会话 running 状态。内部组件保持 props 完备且框架无关。

### TodoRow：经 keyed toolview slot 的逐调用行

专用的 `todo_write` 对话行是一个普通注册者插件（`todoToolview`，由 `apply` 挂载），经 `ctx.slots.inject` 注册进 keyed 的 `tool.call.toolview` slot，遵循与 bash 样例相同的声明生命周期，但属产品级注册。摘要由调用 args 推导（`N/M done · first active item`，其余活跃项的 `+<n>` 计数放在 `ToolRow` 的不收缩 `summarySuffix` 位里）；无法解析的 args 回退到通用行摘要；点击会以原始 args 打开 details 列。todo 不新增任何 `ToolEventView`——呈现归客户端所有，常驻列表从会话事件渲染，而非工具卡。

## 考虑过的替代方案

- **把 todo 写入作为 surface 条目折叠进 `nodes`**——回放的窗口会渲染每一份已被取代的列表；该事件被刻意设计成非 surface 类型。
- **面板硬编码进 `ConversationRoot`**——input-dock slot 出现之前的原始落点；dock 是本架构给「composer 上方常开横条」安排的位置，硬编码绕开了 slot 注册表的 disposal 与定序。
- **面板放进 details 列**——details slot 单占用且由选中驱动，生命周期不同于一条常开横条。
- **host 计算的视图（一个 todo `ToolEventView`）**——呈现属于客户端；协议已在事件载荷里携带整份快照。

## 后果

回放正确性由领域投影所有，`packages/client/ui-conversation/tests/todo-panel.client.spec.tsx` 固定行摘要、工作中／已停止／已完成状态、面板内容与折叠往返。自动化专用的 ACP 桥接刻意不做 todo 呈现；Web 各面渲染同一持久领域值，而不增加 conversation 节点。重开会话时，若计划仍属于当前人类任务就会恢复；自动 Goal Round 保持其可见，之后的人类直接消息则会在下一份计划写入前将其清空。
