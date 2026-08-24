# Agent Note: Leon uses Gemini for automatic web retrieval

Status: implemented

English | [中文](2026-08-23-leon-google-web-retrieval.zh.md)

## Problem

Leon exposed a `web_search` tool in its preset without mounting a usable provider, kept `web_fetch` disabled, and gave the local model no precise rule for deciding when current information required retrieval. A local-first conversation could therefore fail on a search call or answer a time-sensitive question from stale model knowledge.

## Decision

The Web deployment mounts `@deepseek-ai/dsh-web-search-google` and `@deepseek-ai/dsh-web-fetch-http`. The search provider reuses the user-authorized `GOOGLE_API_KEY` credential reference, issues stateless Gemini Interactions requests with the managed Google Search tool, rejects credential-bearing redirects, records the exact secret-free auxiliary request, and returns normalized cited sources through `ctx.web`.

The Leon preset exposes both `web_search` and `web_fetch`. Its persona directs the conversation model to search for explicit research or verification requests and facts likely to have changed, to fetch a page when the page itself matters, and to answer stable reasoning or writing tasks directly. It also forbids copying private local content into a search without user authorization. This preserves the [local-first routing decision](../architecture/2026-08-22-leon-local-first-model-routing.md): the local model remains the conversational route, while Gemini is an explicitly configured tool provider used only after a model-selected search call.

## Alternatives considered

**Mount the existing DeepSeek search provider.** Rejected because DeepSeek is not Leon's selected cloud focus and an inherited DeepSeek credential must not activate remote requests.

**Use Exa or Perplexity.** Rejected for the shipped Leon composition because each requires another credential and account while the user already authorized Gemini.

**Route the entire conversation to Gemini whenever information might be current.** Rejected because it would send more context to the cloud, obscure why the route changed, and replace local-first execution instead of adding a bounded retrieval tool.

**Leave full-page retrieval disabled.** Rejected because source snippets cannot verify a page's complete wording. The existing HTTP provider already enforces public HTTP(S), SSRF, redirect, size, and timeout policy.

## Consequences

Leon can answer stable tasks locally and obtain current, cited information without changing the conversation model. Search and page retrieval appear as ordinary tool calls in the trajectory. Each grounded request may incur Gemini token and Google Search usage, and Google controls the number of native searches inside one request; Leon therefore keeps bounded tool-query and returned-source limits but cannot impose an exact provider-internal search count.

Provider unit tests pin response mapping, dynamic credential resolution, secret-free logging, errors, and redirect rejection. The Web bundle composition test pins the mounted Google and HTTP providers, while the Leon preset test pins both tools and the automatic decision policy.
