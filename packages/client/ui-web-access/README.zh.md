# @deepseek-ai/dsh-client-ui-web-access

[English](README.md) | 中文

[`dsh-web-access`](../../web/web-access/README.zh.md) 的浏览器端对话输入控制。该插件在现有的、会话范围的 `conversation.input.right` 列表 slot 中放置一个紧凑的 **Web** 按钮。其按下状态只来自 Host 投影的 `webAccess.enabled` 值；它不维护乐观的本地权限副本。

选择按钮会通过 commands Remote 为当前确切会话发送 `/web on` 或 `/web off`。随后 Host 事件更新 projection，从而更新按钮状态。请求进行时按钮会禁用；RPC 或命令被拒绝时显示通用本地失败，而不展示传输细节。Host 的 `webAccess` projection 缺失时，控件不渲染，因此同一浏览器 bundle 可以运行在未包含该功能的组合中。

按钮文案和提示刻意仅指原生公开 Web 搜索和抓取；它不会暗示通用浏览器、shell、凭据或不受限制的 Internet 控制。

## 模型体验

间接地，通过改变 `dsh-web-access` 决定并由 `dsh-tool-web` 消费的 Host `/web` 命令。

#### KV Cache 影响

无；UI 交互不会改变提供方请求或对话组装。

## 已知限制与暂缓事项

- **没有自主研究工作流** —— 启用能力允许后续原生工具调用，但不会使模型自动搜索或选择来源数量。
- **没有全局默认值** —— 按钮只改变当前会话；新会话从禁用 Web 访问开始。
- **需要 Host 可用** —— 断开连接或较旧的 Host 可能拒绝命令；在下一次成功 Host 更新前，可见状态保持最后一个 projection。
