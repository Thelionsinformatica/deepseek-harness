# @deepseek-ai/dsh-web-search-google

[English](README.md) | 中文

这是 Harness [Web 能力](../web/README.zh.md)（`ctx.web`）的 Google Search grounding `WebSearchProvider`。它发送启用托管 `google_search` 工具且不保存状态的 Gemini Interactions API 请求，再把 model-output 文本和 `url_citation` 注解映射为 [`dsh-tool-web`](../tool-web/README.zh.md) 使用的标准 `WebSearchResult`。

提供方复用 Leon 的 Gemini 模型路由所用的 `GOOGLE_API_KEY` 凭据引用。每次搜索都会通过 `ctx.credentials` 解析该引用；没有凭据服务时才读取启动环境。密钥不会进入请求日志或提供方结果。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Google API 密钥字面值。应优先使用 `apiKeyEnv`，避免机密进入配置。 |
| `apiKeyEnv` | `GOOGLE_API_KEY` | 每次搜索解析的凭据引用。缺失时以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://generativelanguage.googleapis.com/v1beta` | Gemini API 基址；提供方追加 `/interactions`。 |
| `model` | `gemini-3.6-flash` | 接收辅助搜索请求的 Gemini 模型。该模型必须支持 Google Search grounding。 |

```yaml
- id: web-search-google
  name: '@deepseek-ai/dsh-web-search-google'
  config:
    apiKeyEnv: GOOGLE_API_KEY
    model: gemini-3.6-flash
```

插件安装 `web-search-google` Settings 分节。凭据引用、端点或模型的变更会作用于下一次搜索，无需注销提供方。

## 请求与结果映射

每次搜索都会发送 `store: false`、包含调用方查询的简短搜索指令，以及 `tools: [{ type: 'google_search' }]`。携带凭据的请求会在接触 `Location` 目标之前拒绝 HTTP 重定向。

响应的 model-output 文本成为 `content`。去重后的 `url_citation` 注解成为 `sources[]`；URL 和标题直接复制，有效的引用文本区间成为 `snippet`。通用 Web 服务在映射后应用 `maxResults`。HTTP、凭据、取消与响应格式失败保留稳定的 `WebError` 代码。

由 Agent 发起的搜索会在网络请求前向会话追加 `web/google-search-llm-request`。该事件只包含端点和不含机密的精确请求体。派发前发生的凭据失败或取消不会产生事件。

## 模型体验

### 辅助 Google Search 请求

#### 模型看到的内容

Gemini 收到一个独立指令：针对查询搜索公开 Web、返回不超过请求来源上限的结果，并根据引用页面生成简洁答案。该请求不属于对话历史，也不会保存为 Gemini interaction。

#### Token 影响

每个 `web_search` 查询都会产生一次辅助 Gemini 请求。Google 在 grounding 过程中可能执行一次或多次计费的原生搜索查询。

#### KV Cache 影响

它独立于对话模型缓存。指令前缀稳定；查询与结果上限随调用变化。

### 间接的对话结果

#### 模型看到的内容

通过 `dsh-tool-web`，对话模型会收到 grounded 摘要，以及可点击的来源 URL、标题和可用引用片段，并被要求在最终答案中引用相关 URL。

#### Token 影响

注册不会直接增加对话 token。返回的答案与来源文本会保留在对话历史中，直到压缩。

#### KV Cache 影响

仅追加；工具结果位于可复用对话前缀之后。

## 已知限制与后续工作

- Google 决定一次 grounded 请求执行多少次原生搜索；`searchMaxQueries` 限制工具调用数，`searchMaxResults` 限制返回来源数，但两者都不能限制提供方内部的计费搜索查询。
- 同步 `available()` 检查可以确认凭据解析器存在，但不能读取异步凭据存储。缺少密钥的已选提供方会在执行时失败。
- 引用注解提供的是答案中的被引用区间，而非来源页面的完整摘录。模型需要页面本身时，仍应继续调用 `web_fetch`。
