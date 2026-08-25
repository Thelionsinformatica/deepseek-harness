# @deepseek-ai/dsh-personal-memory

[English](README.md) | 中文

`PersonalMemoryRuntime`（`ctx.personalMemory`）是面向提供方中立的持久事实服务，事实属于一个显式本地所有者，而不是某个项目 workspace。它拥有独立的提供方注册表，绝不会把路径、隐藏 workspace、账户 id 或遥测 id 当作个人所有权。

## 行为

每个创建、搜索、列出、纠正和遗忘请求都携带有界的 `PersonalMemoryOwnerId`。内容与查询会在提供方执行前被修剪并限制长度。纠正和遗忘要求精确的 `MemoryId` 与 revision，因此陈旧上下文不能覆盖较新的事实。

服务会在持久化前拒绝已知的类似凭据模式，包括常见 API key、access token、private key、密码、JWT 和云凭据。这是保守的纵深防御，而不是通用数据防泄漏系统。调用方仍须把写入限制为用户明确要求记住或已经确认的持久事实。

提供方选择不依赖注册顺序。显式提供方必须存在且可用；否则必须恰好有一个可用提供方。不含内容的 `personal-memory/operation` 与 `personal-memory/blocked` 事件会公开操作健康状态，但不包含记忆正文。

runtime 还接受实时启用偏好。禁用时，模型回忆、创建和纠正会在提供方执行前失败。管理列表与永久遗忘仍然可用，因此禁用功能不会阻止用户检查或删除本地数据。

## 模型体验

间接通过 `@deepseek-ai/dsh-tool-memory` 呈现：当配置有效的 `personalOwnerId` 时，该包提供显式的个人记住、搜索、纠正和遗忘工具，以及可选的有界首步回忆；本服务本身不添加模型可见工具或提示词内容。

#### KV Cache 影响

本服务不会直接影响 KV Cache。Consumer 负责面向模型的工具、提示词段落与回忆快照。

## 已知限制与暂缓事项

- 交付的约定面向每个 Leon 部署的单一本地所有者分区；系统不会推断经过身份验证的多用户所有权。
- 尚未实现本地存储加密。文件继承已配置存储后端与操作系统访问控制。
- Leon Web 组合通过 `@deepseek-ai/dsh-tool-memory/review` 提供带确认的浏览器管理面板；其他组合必须自行提供面向所有者的控制。
- 凭据检测无法识别所有 secret 格式，个人记忆也不适合存放文档正文或受监管记录。
