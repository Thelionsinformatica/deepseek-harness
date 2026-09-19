# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，以及严格受控的运行时开关。`PluginInventoryGateway` 注册 `pluginInventory`，并发布生成的直接 Remote：`pluginInventory/list` 返回当前清单；`pluginInventory/setEnabled` 只改变当前进程中一个经过部署审计的可选条目。

每次 list 调用都直接读取 `ctx.loader.entries()`，跳过结构性 group 行，并保留 Loader 顺序。每个返回条目包括 Loader id、安全模块标识、有效启用状态、根 Fiber 阶段和安全的推断展示元数据：类别、简短摘要、能力、激活模式及其原因。投影绝不序列化原始 Loader 配置、来源、源路径、凭据、cookie 或 token。阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；没有存活根 Fiber 时为 `null`。

`liveToggleEntries` 是由稳定 `Entry.options.id` 和公开模块标识配对组成的部署拥有允许列表，默认不提供任何实时控件。配对两个值可防止 Loader 树中其他同名条目继承授权。`setEnabled` 需要精确列出的配对，在允许列表前先将结构性 group、本地／URL 形态的标识以及受保护的会话、安全、传输和核心模块分类，并直接调用所选条目的 `Entry.update()`。它刻意不调用 `ctx.loader.update()`：由此产生的启用状态变更仅限进程，不会写入 profile、bundle、include-tree 或 user-patch 配置，并会在重启时重置。所有其他条目仍以 `restart-required` 显示供诊断；受保护条目明确标为 `protected`。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.zh.md) 组合消费它，而不导入 Host 实现。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

## 模型体验

无，因为这个仅限 Host 的清单服务不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **调用当下的清单** —— list 没有持久失败历史或订阅；不存在根 Fiber 时为 `null`，无论没有存活根的原因是什么。
- **仅运行时开关** —— 即使经过审计的可选开关也会在重启时丢失，且不能编辑、添加、删除或配置插件。
- **没有来源模型** —— 服务不识别引入条目的 bundle、profile 或 override；操作员必须在所属的部署配置中完成经过审查的持久性变更。
