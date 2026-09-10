# @deepseek-ai/dsh-web-access

[English](README.md) | 中文

`dsh-web-access` 为原生 `web_search` 与 `web_fetch` 工具维护明确、可持久化的**每会话**授权。它提供 `ctx.webAccess`，从会话的最新 `web/access` 事件折叠状态；存在 projection 注册表时发布 `webAccess` 会话 projection；存在命令运行时时注册 `/web <on|off>`。

新会话默认禁用 Web 访问。`/web on` 追加 `{ enabled: true }`，`/web off` 追加 `{ enabled: false }`；重复选择当前有效状态不会产生重复事件。`dsh-tool-web` 执行器会在请求单次批准前读取该授权。因此，启用的会话可以使用原生公开搜索和抓取工具而无需重复提示；撤销授权后，下一次调用立即恢复普通的 `egressPolicy: ask` 行为。

## 范围与安全性

该授权**不会**改变文件沙箱、shell、浏览器自动化、MCP、凭据、全局批准策略、其他具有网络能力的插件或直接提供方调用。它刻意只是两个原生 Web 执行器的狭窄策略输入。会话事件是本地审计证据，不会被其他会话继承；即使早前会话仍处于启用状态，新会话也从禁用状态开始。

`dsh-web-access` 在无界面组合中同样可用：即使没有 Commands 或会话 projection，服务仍可写入和读取会话状态。未组合该服务时，`dsh-tool-web` 保持原有的逐次批准行为。

## 模型体验

间接地，通过消费该会话决定的原生 `dsh-tool-web` 批准路径。

#### KV Cache 影响

无；服务不参与提供方请求或对话组装。

## 已知限制与暂缓事项

- **仅限公开工具** —— 该授权不允许任意 Internet 访问、已认证提供方、浏览器自动化、shell 网络或原生 `web_search` 与 `web_fetch` 执行器之外的任何扩展。
- **仅限会话** —— 授权会随会话回放保留，用于审计与立即撤销，但不会成为未来会话的默认值，也没有目标地址白名单。
- **提供方策略仍具权威性** —— 抓取的 SSRF/重定向限制、提供方凭据、可用性检查、速率限制以及 `egressPolicy: allow` 部署仍是独立职责。
