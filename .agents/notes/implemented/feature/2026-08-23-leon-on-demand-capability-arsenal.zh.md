# Agent Note: Leon 无需切换模式即可按需加载能力

Status: implemented

[English](2026-08-23-leon-on-demand-capability-arsenal.md) | 中文

## Problem

Leon 已经拥有广泛的 coding-agent 工具集，但重要的 Work 风格能力要么没有连接到 Web 组合，要么隐藏在无关 preset 后面。浏览器操作没有受维护的运行时，提醒工具虽存在于仓库却未挂载；若加入大型 MCP 浏览器服务器，又会在完全不需要浏览器时永久增加每次本地模型请求的负担。

## Decision

Leon 保持一个助手身份，并保留现有原生工具。专门的操作指导通过现有 scoped 技能目录发布，只在请求匹配时加载。出厂 preset 现在包含 `leon-browser`、`leon-project-engineer` 与 `leon-windows`。

Web bundle 固定 `@playwright/cli` 版本，通过受信任的受管 shell 变量发布其精确入口与当前 Node 可执行文件，并由 `leon-browser` 打开可见、持久且归 Leon 所有的 Chrome 会话。该技能要求每次动作后检查状态，并在会产生外部重要影响的提交前显式暂停等待批准。

Web 宿主还会在未来浏览器会话创建前挂载时间上下文与 Schedule。新的 root agent 获得会话范围内持久的提醒工具，Leon persona 必须使用这些工具，不能只在文字中承诺记住。

## Alternatives considered

**永久公开所有 Playwright MCP 工具。** 不采用，因为数十个动态 schema 与大型无障碍响应会在无关轮次拖累小型本地模型。固定 CLI 加按需技能可保留持久浏览器状态，同时缩小稳定提示词。

**把浏览器与 Windows 访问放进不同 agent preset。** 不采用，因为产品方向是由同一个 Leon 自动选择能力；切换 persona 会割裂记忆，并迫使用户选择实现细节。

**通过 PowerShell 声称完整 Windows GUI 控制。** 不采用，因为 PowerShell 能操作系统并启动应用，却不能证明任意桌面点击或视觉状态。Windows 技能明确说明这一边界。

**让提醒继续只作为示例 overlay。** 不采用，因为提醒是正常助手能力，而现有实现已经持有持久性、时区解释与生命周期边界。

## Consequences

Leon 现在无需切换 preset 即可搜索和读取 Web、打开并控制可见浏览器、通过现有批准型 shell 边界操作 Windows，以及创建、列出和删除提醒。技能正文只在加载时产生 token 成本。除非用户在 Leon 自有窗口中登录，否则浏览器认证与个人浏览器隔离；高影响浏览器动作仍要求明确确认。

Playwright CLI 是已安装且固定版本的应用依赖，必须继续由 Windows 上真实的可见浏览器 smoke test 覆盖。提醒仍只属于会话：不会唤醒已停止的宿主，也不会发送外部通知。任意桌面应用的像素级自动化与用户可配置 MCP connector 仍是独立的未来能力。
