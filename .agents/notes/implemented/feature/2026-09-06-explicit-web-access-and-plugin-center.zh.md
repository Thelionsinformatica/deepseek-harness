# Agent Note: 明确的 Web 访问与保守的插件中心控制

Status: implemented

[English](2026-09-06-explicit-web-access-and-plugin-center.md) | 中文

## 问题

Leon 配置通过请求对外批准来保证原生 Web 调用安全，但用户在一个会话中明确选择研究时，仍需要为每次搜索或抓取重复提示。无关的文件系统「完全访问」选择器可能让人以为它承诺了 Internet 能力，尽管它既不是 Web 授权，也不是可撤销的会话决定。

现有插件清单只暴露 Loader 标识和状态。用户无法得知插件的用途、某个开关是否安全或为何控件不可用。然而，把清单变成通用 Loader 编辑器会使浏览器 RPC 能够持久化任意包配置，或停用 Host、会话、安全和传输基础设施。

## 决策

### 明确的原生 Web 授权

[`dsh-web-access`](../../../../packages/web/web-access/README.zh.md) 拥有 `web/access` 会话事件、`webAccess` projection 和 `/web on|off`。新会话折叠为禁用。启用会记录本地、可持久化、可审计的决定；禁用会记录撤销，并立即恢复 [`dsh-tool-web`](../../../../packages/web/tool-web/README.zh.md) 的正常行为。当 `egressPolicy` 为 `ask` 时，原生 `web_search` 和 `web_fetch` 执行器只会在其精确活动会话已启用时跳过单次批准。浏览器端的 [`dsh-client-ui-web-access`](../../../../packages/client/ui-web-access/README.zh.md) 按钮将 projection 作为唯一状态来源，并明确说明该狭窄范围。

该授权不修改 `ApprovalPolicy`、文件系统沙箱范围、浏览器自动化、shell 网络、MCP、凭据、直接提供方或任何其他网络能力插件。它不会被新会话继承，也不是通用 Internet 权限。它扩展而不替代[对外批准决策](2026-09-04-web-tool-outbound-consent.zh.md)所记录的默认逐次策略。

### 保守的插件中心

[`dsh-host-plugin-inventory`](../../../../packages/host/plugin-inventory/README.zh.md) 使用安全推断的类别、摘要、能力和管理元数据来分类当前非 group 的 Loader 条目。它的部署 `liveToggleEntries` 允许列表将每个稳定配置 id 与精确公开模块标识配对，并默认为空。结构性 Loader group、本地或 URL 形态的标识以及受保护的核心／会话／安全／传输条目优先于该允许列表；所有未列出条目都是 `restart-required`，仅供检查。

`setEnabled` Remote 只接受精确的允许列表中、且非受保护的条目，并直接调用 `Entry.update()`。它不调用 `ctx.loader.update()`，所以不会写入 profile、bundle、include-tree 或 user-patch。变更只存在于运行进程，并会在重启时丢失。[`dsh-client-ui-settings-plugin-inventory`](../../../../packages/client/ui-settings-plugin-inventory/README.zh.md) 呈现该分类，只为 Host 返回为 `live-toggle` 的条目渲染操作；其状态只会由 Host 响应替换。

## 考虑过的替代方案

**将完全访问当作 Web 访问。** 被否决，因为沙箱范围回答的是文件系统限制，而不是公开 Internet 披露。让该选择器悄悄改变 egress 会耦合无关能力，也不会留下清晰的审计事件或立即的会话撤销。

**将全局批准策略改为 allow。** 被否决，因为全局授权会影响无关的批准通道，并把会话范围的用户决定变成持久默认值。狭窄事件保持每一条非 Web 批准路径不变。

**为每一个 Loader 条目提供一个开关。** 被否决，因为 Loader 包含组合、传输、会话、安全和核心条目，丢失它们可能破坏 Host 或恢复路径。保守的部署允许列表让操作员而不是浏览器客户端选择极少数有资格进行运行时切换的可选条目。

**为操作使用 `ctx.loader.update()`。** 被否决，因为它参与 Loader 树的持久化。直接 `Entry.update()` 让开关可通过重启撤销，并阻止 UI 点击写入任何部署或用户配置。

## 后果

用户可以为当前会话可见地启用一次原生公开搜索和抓取，然后无需重启即可关闭。默认值保持保守，会话回放保留该决定用于本地审计，新会话从禁用开始。这并不构成数据泄漏防护系统：查询内容仍可能敏感，提供方策略和重定向控制仍是独立职责，且授权绝不覆盖任意网络。

插件中心在不暴露含秘密配置的情况下提供有用的运行信息。Leon web-app bundle 中只有 `web-search-google` 和 `web-fetch-http` 被配置为 live-toggle 示例；其状态变更从不持久化。需要持久配置变更的插件必须使用其所属部署机制，并在审查后重启。

## 验证

聚焦 Host 和 Client 套件固定了默认禁用的 Web 状态、会话事件折叠、命令决定、projection teardown、只在已授权时绕过 ask 策略，以及立即撤销。它们还固定了插件中心元数据、生成的 Remote 方法、精确允许列表强制、受保护条目拒绝、进程内无写入开关、显示状态替换，以及未列出条目没有操作。Host 和 Client 库构建对两个新包做类型检查并重新生成 Remote 契约。最终组装的 Web 构建和实时 GUI 检查仍是该功能的集成证据。
