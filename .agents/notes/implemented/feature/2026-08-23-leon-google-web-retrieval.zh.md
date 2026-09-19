# Agent Note: Leon 使用 Gemini 进行自动 Web 检索

Status: implemented

[English](2026-08-23-leon-google-web-retrieval.md) | 中文

## Problem

Leon 的 preset 暴露了 `web_search` 工具，却没有挂载可用提供方；`web_fetch` 保持禁用，本地模型也没有明确规则判断何时必须检索当前信息。因此，本地优先的对话可能在搜索调用时失败，或用过时的模型知识回答时效性问题。

## Decision

Web 部署挂载 `@deepseek-ai/dsh-web-search-google` 与 `@deepseek-ai/dsh-web-fetch-http`。搜索提供方复用用户已授权的 `GOOGLE_API_KEY` 凭据引用，通过托管 Google Search 工具发送不保存状态的 Gemini Interactions 请求，拒绝携带凭据的重定向，记录不含机密的精确辅助请求，并通过 `ctx.web` 返回标准化的引用来源。

Leon preset 同时暴露 `web_search` 与 `web_fetch`。其 persona 指示对话模型在用户明确要求研究或核实时搜索，也在事实可能已经变化时搜索；当页面本身重要时抓取页面；稳定的推理或写作任务则直接回答。它也禁止未经用户授权把私有本地内容复制到搜索中。这保留了[本地优先路由决定](../architecture/2026-08-22-leon-local-first-model-routing.zh.md)：本地模型仍是对话路由，Gemini 只是显式配置的工具提供方，仅在模型选择搜索调用后使用。

## Alternatives considered

**挂载现有 DeepSeek 搜索提供方。** 不采用，因为 DeepSeek 不是 Leon 选定的云端重点，而且继承的 DeepSeek 凭据不能自动激活远程请求。

**使用 Exa 或 Perplexity。** 不作为 Leon 出厂组合，因为两者都要求额外凭据与账户，而用户已经授权 Gemini。

**只要信息可能较新，就把整个对话路由到 Gemini。** 不采用，因为这样会向云端发送更多上下文、隐藏路由变化原因，并以云端替换本地优先执行，而不是增加受限的检索工具。

**继续禁用完整页面检索。** 不采用，因为来源片段无法核验页面的完整措辞。现有 HTTP 提供方已经执行公开 HTTP(S)、SSRF、重定向、大小与超时策略。

## Consequences

Leon 可以在本地回答稳定任务，并在不更换对话模型的情况下取得当前且带引用的信息。搜索与页面抓取在轨迹中显示为普通工具调用。每次 grounded 请求可能产生 Gemini token 与 Google Search 用量，而一次请求内部的原生搜索次数由 Google 控制；Leon 因此限制工具查询数与返回来源数，但无法规定提供方内部的精确搜索次数。

提供方单元测试固定响应映射、动态凭据解析、不含机密的日志、错误与重定向拒绝。Web bundle 组合测试固定 Google 与 HTTP 提供方的挂载，Leon preset 测试固定两个工具与自动决策策略。
