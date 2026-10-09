---
description: "工具守卫：每次 web_search 或 web_fetch 调用在任何数据离开本机之前都先询问用户一次，供组合 Leon 网络策略的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-egress-approval

[English](README.md) | 中文

## 概述

挂载在宿主上的工具守卫，在工具主体运行之前把每次 `web_search` 与 `web_fetch` 调用变为一个审批问题。提示显示完整参数，因此用户能看到确切的查询或 URL，包括可能含有私人数据的参数。一次批准只覆盖这一次调用；拒绝、取消、缺少审批通道或 `never` 审批策略都会拒绝调用，因此守卫以关闭方式失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把它挂载在宿主上、与 `@deepseek-ai/dsh-user-approval` 并列，使其覆盖每个组合了 Web 工具的 agent 与子代理：

```yaml
- id: web-egress-approval
  name: '@deepseek-ai/dsh-web-egress-approval'
  config:
    tools: [web_search, web_fetch]
    maxArgumentChars: 8192
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `tools` | `web_search`、`web_fetch` | 每次调用都需要一次性批准的工具名 |
| `maxArgumentChars` | `8192` | 提示中序列化参数的上限；更长的参数会带标记截断 |

<a id="understand-the-implementation"></a>
## 理解实现

本插件加入注册表的 `tools/pre-execute` waterfall。它先让后续监听者决定，只把针对所列工具的 `allow` 变为 `ask`，携带英文原因与本地化的 `displayReason` 文本（`en`、`zh`、`pt-BR`），每段后附参数。注册表通过审批服务解决该 ask，审批服务在会话日志中记录 `approval/asked` 与 `approval/decided` 审计对。拒绝或其他策略的 ask 保持原意。本插件不添加提示文本或工具 schema，也从不包装工具主体，因此上游 `tool-web` 包保持不变。

<a id="model-experience"></a>
## 模型体验

间接地，通过工具注册表的审批结果：获批的调用返回工具的正常结果，被拒绝的调用返回注册表的一个错误，例如 `the user rejected tool "web_search"`。

#### KV Cache 影响

拒绝追加在可复用的请求前缀之后，因此不会使先前的 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **暂无会话级授权** — 分支中可撤销的逐会话 Web 访问开关及其客户端控件尚未移植；每次调用都会询问。
- **Auto 审查会回答询问** — 当可选的 Auto 审查集成是会话的权限预设时，回答这些问题的可能是审查模型而不是用户；Leon 的 profile 未列出该组合包。
- **其他出站路径** — shell、浏览器与 MCP 工具不在本守卫范围内；它们的审批属于沙箱策略和未来的 MCP 允许列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，不具权威性。本守卫用 pre-execute 决策取代了分支在 `tool-web` 执行器内部调用的 `authorizeWebEgress`，0.2.1 的注册表已经会通过审批服务处理该决策。

</details>
