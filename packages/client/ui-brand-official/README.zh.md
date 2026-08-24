# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

只要产品组合挂载本包，它就会以 The Lions Informática 标识和突出显示的 Leon 产品名填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。是否包含本包由产品组合决定；构建 profile 不会静默地用 shell fallback 品牌替换 Leon。

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。它不保留运行时状态。node 半边是空的 Loader seat；浏览器标题仍属于本包之外的构建环境事项。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **本包只提供一组 occupant** —— 其他呈现应由占用相同 slot 的另一个 Cordis 包提供。
- **浏览器标题相互独立** —— renderer 默认使用 `Leon — The Lions Informática`；`DSH_CLIENT_TITLE` 可以在构建期选择其他标题文字，而不经过 UI slot。
