# @deepseek-ai/dsh-web-search-google

English | [中文](README.zh.md)

A Google Search grounding `WebSearchProvider` for the harness [web capability](../web/README.md) (`ctx.web`). It sends a stateless Gemini Interactions API request with the managed `google_search` tool, then maps model-output text and `url_citation` annotations into the normalized `WebSearchResult` consumed by [`dsh-tool-web`](../tool-web/README.md).

The provider reuses the `GOOGLE_API_KEY` credential reference used by Leon's Gemini model route. It resolves that reference for every search through `ctx.credentials`, or through the launching environment when the credential service is absent. The key never enters the request log or provider result.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Google API key. Prefer `apiKeyEnv` so no secret enters configuration. |
| `apiKeyEnv` | `GOOGLE_API_KEY` | Credential reference resolved for each search. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://generativelanguage.googleapis.com/v1beta` | Gemini API base; `/interactions` is appended. |
| `model` | `gemini-3.6-flash` | Gemini model that receives the auxiliary search request. It must support Google Search grounding. |

```yaml
- id: web-search-google
  name: '@deepseek-ai/dsh-web-search-google'
  config:
    apiKeyEnv: GOOGLE_API_KEY
    model: gemini-3.6-flash
```

The plugin installs a `web-search-google` Settings section. Changes to its credential reference, endpoint, or model reach the next search without unregistering the provider.

## Request and result mapping

Each search sends `store: false`, the caller's query inside a short search instruction, and `tools: [{ type: 'google_search' }]`. Credential-bearing requests reject HTTP redirects before contacting the `Location` target.

The response's model-output text becomes `content`. Unique `url_citation` annotations become `sources[]`; URL and title are copied, and a valid cited text interval becomes `snippet`. The generic web service applies `maxResults` after mapping. HTTP, credential, cancellation, and response-format failures retain stable `WebError` codes.

Immediately before network dispatch, a search initiated by an Agent appends `web/google-search-llm-request` to its session. The event contains only the endpoint and exact secret-free body. Credential failures and cancellations before dispatch create no event.

## Model Experience

### Auxiliary Google Search request

#### What the model sees

Gemini receives a separate instruction to search the public web for the query, return no more than the requested source cap, and synthesize a concise answer supported by cited pages. This request is not conversation history and is not stored as a Gemini interaction.

#### Token effect

Each `web_search` query creates one auxiliary Gemini request. Google may execute one or more billable native search queries while grounding it.

#### KV Cache effect

Independent of the conversation model cache. The instruction prefix is stable; the query and result cap vary per call.

### Conversation result, indirectly

#### What the model sees

Through `dsh-tool-web`, the conversation model receives the grounded synthesis followed by clickable source URLs, titles, and available cited snippets. It is instructed to cite relevant URLs in its final answer.

#### Token effect

Registration adds no direct conversation tokens. Returned answer and source text remain in conversation history until compaction.

#### KV Cache effect

Append-only; the tool result follows the reusable conversation prefix.

## Known Limitations and Deferred Work

- Google decides how many native searches one grounded request executes; `searchMaxQueries` bounds tool calls and `searchMaxResults` bounds returned sources, but neither caps provider-internal billed search queries.
- The synchronous `available()` check can verify that a credential resolver exists but cannot read the asynchronous credential store. A selected provider with a missing key therefore fails at execution time.
- Citation annotations expose a cited answer interval, not the source page's full excerpt. `web_fetch` remains the authoritative follow-up when the model needs the page itself.
