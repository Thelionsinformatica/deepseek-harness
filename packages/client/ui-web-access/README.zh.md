---
description: "输入框中的 Web 按钮，用于切换会话级 Web 访问授权，供组合 Leon Web 同意机制的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-access

[English](README.md) | 中文

## 概述

对话输入框中的客户端控件，显示并切换由 `dsh-web-access` 管理的会话 Web 访问授权。按钮反映宿主的 `webAccess` 投影而不是乐观的本地副本，执行 `/web on` 或 `/web off`，在未组合宿主服务时保持隐藏。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `dsh-web-access` 一起挂载宿主行：

```yaml
- id: ui-web-access
  name: '@deepseek-ai/dsh-client-ui-web-access'
```

<a id="understand-the-implementation"></a>
## 理解实现

[`src/client/index.ts`](src/client/index.ts) 在 `conversation.input.right` 列表插槽中注册按钮，并注入一个通过命令 Remote 执行人工命令的 `toggleWebAccess` 接口。[`src/client/WebAccessControl.tsx`](src/client/WebAccessControl.tsx) 根据 `useProjection('webAccess')` 渲染地球按钮。

<a id="model-experience"></a>
## 模型体验

间接地，通过浏览器界面：该控件从不进入模型请求。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **基于命令** — 切换复用 `/web`，因此未组合命令运行时的部署只能显示状态而无法切换。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，不具权威性。从 Leon 分支移植到 0.2.1 客户端插槽 API。

</details>
