# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

Web 设置中的**插件中心**标签页。浏览器插件注册一个 id 为 `all` 的本地化 `settings.plugins.tab` 贡献；“插件”分区拥有导航入口和标签页外壳。插件激活期间不会读取 Remote；选择标签页时才挂载组件，并通过 [`api-remotes`](../../api/remotes/README.zh.md) 懒调用 `ctx.remote.pluginInventory.list()`。

该标签页以可搜索的双列紧凑折叠卡片展示目录。卡片显示模块短名称、有效状态、已启用时的 Fiber 状态、安全类别和摘要，以及管理分类：`live-toggle`、`restart-required` 或 `protected`。展开详情会显示 Loader 条目 id、用途、能力、有效状态、运行时状态及非秘密的管理原因。搜索还会匹配摘要和能力。它绝不渲染原始配置、源路径、凭据、cookie 或 token。

只有 Host 返回为 `live-toggle` 的卡片才显示操作。该操作会为精确条目调用 `setEnabled`，并且只根据 Host 响应替换本地状态；请求进行时会禁用，失败时显示通用 UI 文案而不是传输细节。需要重启和受保护的条目没有修改控件。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化和 teardown，而无需 import 分区拥有方。

## 模型体验

无，因为本包在浏览器 Settings 中展示 Host 拥有的部署快照，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每次 Settings 挂载或重试只读取一份快照** —— 标签页不订阅 Loader 变化，也不会在重连后自动重新读取；切换标签页会保留当前快照，重新打开 Settings 则会取得新快照。
- **运行时控制有意保持狭窄** —— 界面不能持久化选择、编辑配置、添加或删除条目，也不会为 `live-toggle` 之外的任何 Host 分类提供开关。
- **元数据是诊断信息而非来源** —— 类别、能力和摘要标签是安全的运行说明，并不主张原始 bundle 或配置来源。
