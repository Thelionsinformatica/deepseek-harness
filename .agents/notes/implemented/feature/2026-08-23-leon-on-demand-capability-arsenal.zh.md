# Agent Note: Leon 无需切换模式即可按需加载能力

Status: implemented

[English](2026-08-23-leon-on-demand-capability-arsenal.md) | 中文

## Problem

Leon 已经拥有广泛的 coding-agent 工具集，但重要的 Work 风格能力要么没有连接到 Web 组合，要么隐藏在无关 preset 后面。浏览器操作没有受维护的运行时，提醒工具虽存在于仓库却未挂载；若加入大型 MCP 浏览器服务器，又会在完全不需要浏览器时永久增加每次本地模型请求的负担。

## Decision

Leon 保持一个助手身份，并保留现有原生工具。专门的操作指导通过现有 scoped 技能目录发布，只在请求匹配时加载。出厂 preset 现在包含 `leon-browser`、`leon-project-engineer` 与 `leon-windows`。

Web bundle 固定 `@playwright/cli` 版本，通过受信任的受管 shell 变量发布其精确入口与当前 Node 可执行文件，并由 `leon-browser` 打开可见、持久且归 Leon 所有的 Chrome 会话。该技能要求每次动作后检查状态，并在会产生外部重要影响的提交前显式暂停等待批准。

当用户明确询问“此页面”或当前打开的浏览器时，`leon-browser` 会先运行随技能提供的 `scripts/context.mjs` helper，而不是要求用户手工提供 URL。helper 只查询固定的 Playwright `leon` 会话，返回有界的活动标签页元数据、标签页清单、警告/错误摘要和无障碍快照，并把最后结果保存在 `DSH_HOME/browser-context/`，供页面未变化的后续请求复用。它拒绝不安全的会话名，从 Playwright 子进程环境中移除名称形似凭据的变量，并且从不读取 cookie、浏览器存储、请求头、请求体或截图。导航、重新加载、切换标签页或页面交互之后，技能必须重新检查，不能复用旧状态。

当用户明确要求操作原生 Windows 应用时，`leon-windows` 现在可以运行随技能提供的 `scripts/uia.ps1` connector。connector 通过 Windows UI Automation 列出顶层窗口、检查当前聚焦或指定的窗口，并返回受深度与节点数量限制的无障碍树，同时不读取控件值。只有请求把检查所得的精确 `windowId` 与进程名再次作为 allowlist，并通过 automation ID 或精确名称和类型唯一解析到一个无障碍控件时，修改操作才会放行。Invoke、Value、Selection 和显式的新文件截图操作都会在 `DSH_HOME/windows-uia/` 下追加本地 JSONL 审计事件；输入值不会写入日志，密码控件会被拒绝，而且 connector 不注入全局按键、不使用屏幕坐标、不覆盖截图，也不提升权限。

Web 宿主还会在未来浏览器会话创建前挂载时间上下文与 Schedule。新的 root agent 获得会话范围内持久的提醒工具，Leon persona 必须使用这些工具，不能只在文字中承诺记住。

## Alternatives considered

**永久公开所有 Playwright MCP 工具。** 不采用，因为数十个动态 schema 与大型无障碍响应会在无关轮次拖累小型本地模型。固定 CLI 加按需技能可保留持久浏览器状态，同时缩小稳定提示词。

**把活动页面附加到每一次模型请求。** 不采用，因为无关请求会在没有用户意图时传输私有页面内容并消耗上下文。明确的浏览器请求只授权一次有界检查；页面未变化的后续请求可以复用本地缓存。

**默认使用基于坐标的桌面自动化。** 不采用，因为像素和坐标无法证明动作会落在哪个控件上，并会随着 DPI、布局和窗口变化而漂移。UI Automation connector 要求语义化且唯一的目标；应用不暴露无障碍控件时会安全失败。

**持续捕获桌面作为视觉上下文。** 不采用，因为这会在没有任务特定意图时收集无关的私有窗口。截图必须显式触发，只能针对一个已允许的窗口，只能保存到任务选择的新绝对 PNG 路径，并且绝不会自动附加。

**把浏览器与 Windows 访问放进不同 agent preset。** 不采用，因为产品方向是由同一个 Leon 自动选择能力；切换 persona 会割裂记忆，并迫使用户选择实现细节。

**通过 PowerShell 声称完整 Windows GUI 控制。** 不采用，因为 PowerShell 能操作系统并启动应用，却不能证明任意桌面点击或视觉状态。Windows 技能明确说明这一边界。

**让提醒继续只作为示例 overlay。** 不采用，因为提醒是正常助手能力，而现有实现已经持有持久性、时区解释与生命周期边界。

## Consequences

Leon 现在无需切换 preset 即可搜索和读取 Web、打开并控制可见浏览器、无需用户提供 URL 即可识别 Leon 自有浏览器的活动标签页、通过现有批准型 shell 边界操作 Windows，以及创建、列出和删除提醒。技能正文只在加载时产生 token 成本。除非用户在 Leon 自有窗口中登录，否则浏览器认证与个人浏览器隔离；缓存的无障碍上下文会一直留在本机，直到明确的浏览器任务调用 helper；高影响浏览器动作仍要求明确确认。

Playwright CLI 是已安装且固定版本的应用依赖，必须继续由 Windows 上真实的可见浏览器 smoke test 覆盖。Windows UI Automation 现在默认只读，动作始终限定在一个明确允许的进程和窗口中；不支持的纯像素应用仍会被清楚标记为限制，而不会被视作可隐式使用坐标点击的许可。提醒仍只属于会话：不会唤醒已停止的宿主，也不会发送外部通知。下一个 P1 增量是把个人记忆实现为独立的本地 provider，并赋予它自己的作用域和生命周期，确保项目记忆不会跨 workspace 泄漏。用户可配置的外部 connector 仍是更后续、可独立撤销的能力。
