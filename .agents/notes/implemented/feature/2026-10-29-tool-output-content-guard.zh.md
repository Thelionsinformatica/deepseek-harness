# Agent Note: 工具输出的内容守护

Status: implemented

[English](2026-10-29-tool-output-content-guard.md) | 中文

## 问题

每个工具结果都是不受信的输入通道：`web_fetch` 抓到的页面、第三方 MCP 服务器，或工作区之外的文件，都可能携带看起来像指令的文本，而模型可能照做。harness 在这个边界上没有任何检查——最接近的机制是凭据存储保护、沙箱和客户端密钥掩码，它们都不看工具返回了什么。同类 harness 已经把专门的内容防御能力（提示注入与 PII 扫描）作为常驻层发布。

## 决定

[`dsh-content-guard`](../../../../packages/guard/content-guard/README.zh.md) 在 `tools/post-execute` 瀑布上安装一个监听器。它扫描实际会到达模型的内容——并尊重下游对内容的替换——针对两个固定规则族：指令样式文本（`instruction-override`、`behaviour-override`、`role-hijack`、`prompt-exfiltration`、`chat-template`、`turn-spoofing`）与凭据样式的密钥（`private-key`、`jwt`、`cloud-api-key`、`service-token`）。被标记的结果会追加一条注入的 `user/message` 通知，列出命中的规则标识并告诉模型把该输出当作数据。

守护默认是建议式的，从不阻断。它也从不改写指令样式的文本：掩盖证据会与警告本身矛盾。可选的 `redact` 模式把检测到的密钥在面向模型的内容中替换为 `[redacted:<rule>]`，适用于绝不允许凭据到达模型的部署；当下游监听器替换结果值时跳过，因为该值拥有投影。

通知使用新的注入消息来源类型（`content-guard`）并带 `form: 'notice'`，因此模型可见的警告可以从 Session 日志重建。不引入新的 Session 事件类型：通知走既有的注入 `user/message` 通道，因此不需要持久化确认。

扫描以 `maxScanChars`（默认 65,536）在结果的文本块之间设有上界，因此成本与载荷大小无关。诊断只携带规则标识；命中的密钥绝不会出现在通知或宿主日志中。

## 考虑过的替代方案

**命中即阻断调用。** 否决：启发式命中不是恶意证据，而结果的价值常常恰恰在于讨论指令的那一页。阻断会把误报变成失败任务；建议式通知让模型保持控制。

**改写所有被标记的内容。** 否决：脱敏指令文本会破坏警告所指的证据，而改写普通文本会破坏必须往返的工具输出。

**引入机器学习分类器。** 推迟：本包必须保持无依赖且可预测，而规则标识可审计。分类器之后可以在同一通知契约后面替换或补充 `matchingRules`。

**现在就加入 PII 启发式。** 推迟：姓名、地址和号码在普通工程工作中随处可见，误报代价高于当前的需求证据。密钥格式和指令措辞的信号更明确。

## 后果

- 读取提示注入示例的部署会在每次这类读取时产生通知。
- 不匹配任何规则的改写指令不会被标记。
- 每个被标记的结果增加一条消息，约 45 token；否则零 token。
- 脱敏只改变面向模型的密钥内容；Session 日志记录脱敏后的内容，因此模型可见值仍可重建。

## 验证

- `vitest run packages/guard/content-guard`——11 个测试覆盖干净输出、标注、密钥检测且不回显、脱敏、`redact` 不改写指令文本、开关、扫描上界、包含/排除范围、下游阻断保留、加载期显式失败，以及具名插件表面。
- `pnpm run typecheck` 通过全部五项门禁，`pnpm run lint` 报告零错误。
- `pnpm run gen-config-catalog` 把插件配置 schema 记录进生成的配置目录，包 README 配对承载模型体验、限制与 token 影响契约。
