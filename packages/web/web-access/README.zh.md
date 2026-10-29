---
description: "原生 Web 工具的会话级用户授权，供组合 Leon Web 同意机制的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-access

[English](README.md) | 中文

## 概述

宿主服务，为每个会话记录一项明确的用户决定：原生 `web_search` 与 `web_fetch` 工具能否在无逐次审批的情况下运行。该决定是持久的 `web/access` 会话事件，默认关闭，并可随时通过 `/web off` 或输入框中的 Web 按钮撤销。它不访问网络、不改变沙箱，也不修改全局审批预设；由 `dsh-web-egress-approval` 守卫读取。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把它挂载在宿主上、与出站守卫并列；`dsh-client-ui-web-access` 添加输入框按钮：

```yaml
- id: web-access
  name: '@deepseek-ai/dsh-web-access'
```

`/web` 报告当前状态，`/web on` 为本会话授予 Web 访问，`/web off` 撤销。重复当前值不会追加任何内容，因此日志是对真实决定的审计。

<a id="understand-the-implementation"></a>
## 理解实现

[`src/index.ts`](src/index.ts) 注册 `webAccess` 会话投影（折叠最近的 `web/access` 事件并通过其 wire 视图暴露给客户端），并在组合了命令运行时时注册 `/web` 命令。`ctx.webAccess.isEnabled(session)` 读取该投影；`set` 只在值改变时追加新事件。

<a id="model-experience"></a>
## 模型体验

间接地，通过 Web 出站守卫：该授权不添加提示文本或工具 schema，只决定守卫是否在 Web 调用前询问。

#### KV Cache 影响

无；切换授权不改变任何请求内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限原生 Web 工具** — shell、浏览器与 MCP 流量不在该授权范围内。
- **按会话** — 新会话默认关闭；没有全局默认值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，不具权威性。移植自 Leon 分支，分支中出站检查位于 `tool-web` 内；在 0.2.1 中检查是独立的 `dsh-web-egress-approval` 守卫，状态是会话投影而不是同步的历史折叠。

</details>
