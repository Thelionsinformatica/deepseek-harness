# @deepseek-ai/dsh-tool-web

English | [中文](README.zh.md)

The model-facing web tool suite — `web_search` and `web_fetch` — over the [web capability seam](../web/README.md) (`ctx.web`). It owns model-facing concerns only: tool names, JSON schemas, snake_case argument names, prompt sections, the result-count bound, result formatting, HTML→markdown presentation, and the UI presentation projection — `presentCall`, `presentResult` (a `card: 'web'` result card discriminated by `kind: 'search' | 'fetch'`), and the `output.presentationMeta` that carries the structured search sources or the fetch summary the lossy render text cannot (see the [web-result-card Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card.md)). All web access goes through `ctx.web`; this package never imports a concrete provider. Neither tool exposes a model-facing timeout — each tool's cooperative tool-call budget is declared here via config (`fetchTimeoutMs`/`searchTimeoutMs`, attached as `ToolDefinition.timeoutMs`) and enforced by [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) (a `tools/execute` wrapper). Single operations forward `exec.signal`; a multi-query search fuses it with batch cancellation so a failed query aborts its siblings.

Each tool is registered independently; a product that wants only one disables the other via config (`{ search: false }` / `{ fetch: false }`). Search guidance mentions `web_fetch` only when fetch is also config-enabled; a search-only composition instead tells the model to use returned snippets and cite their URLs.

## Tools

| Tool | Args | Behavior |
|---|---|---|
| `web_search` | `queries` (required string[]) | Discovery. Returns an optional answer plus source URLs. It runs one to `searchMaxQueries` distinct searches concurrently and merges their sources in round-robin order before applying the combined `searchMaxResults` cap. A one-item array performs one search. Exact duplicate queries run once. Any failed search aborts the remaining batch, which settles before the call returns an error. Neither bound is model-facing. |
| `web_fetch` | `url` (string) | Retrieves a specific URL. HTML bodies are rendered to markdown (turndown with GFM tables/strikethrough); text bodies pass through. A non-2xx status is reported, not an error. The tool-call timeout is deployment policy (`dsh-tool-call-timeout-policy`), not a model argument. |

Both tools opt into concurrent scheduling in `allow` mode. In `ask` mode, the agent schedules calls serially so interactive approvals do not overlap; an approved multi-query search still fans out concurrently.

The normalized service results are also the canonical tool values: `WebSearchResult` and `WebFetchResult`. Native renderers preserve the answer/source and fetched-body text below; provider search/body caps remain acquisition limits rather than presentation-only truncation.

## Config

| Key | Default | Meaning |
|---|---|---|
| `egressPolicy` | `allow` | `ask` requires a fresh audited approval before each outbound tool call unless the same session holds an explicit `dsh-web-access` grant; `allow` adds no web-specific approval. The Leon preset selects `ask`. |
| `search` | `true` | Register `web_search`. |
| `fetch` | `true` | Register `web_fetch`. |
| `searchMaxResults` | `8` | Upper bound on sources returned by one `web_search` call (the seam truncates each provider list; the tool also caps a combined multi-query list). |
| `searchMaxQueries` | `4` | Upper bound on queries accepted by one `web_search` call. The configured value appears in its prompt guidance and schema descriptions. |
| `fetchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) for `web_fetch`. |
| `searchTimeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) for `web_search`. |
| `fetchMaxOutputChars` | `200000` | Cap on source characters converted synchronously and on one complete `web_fetch` output (header, rendered body, and footer); a cut body gets the truncation notice when it fits. |

`searchMaxQueries` bounds the accepted array before exact-string deduplication, provider fan-out, and combined provider-answer growth; validation rejects an oversized array before any search starts, then dispatch keeps the first occurrence of each query. Together with each provider's own controls such as `maxUses`, these independent settings are the product's search budgets; the generic seam does not expose provider-internal native-search accounting. `fetchTimeoutMs`/`searchTimeoutMs` declare each tool's cooperative timeout budget (attached as `ToolDefinition.timeoutMs`), enforced by [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md); the model-facing schema exposes no timeout argument. `fetchMaxOutputChars` bounds both synchronous conversion work and the complete rendered result: only that many source characters are converted, and the header, converted prefix, and truncation notice are then capped together. The default leaves headroom above the local provider's 100,000-character body cap, but rendered expansion can still make the final bound truncate the result.

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
```

## Stable registration

With `egressPolicy: ask`, the executor validates arguments, then requests `ctx.approval` before calling `ctx.web` unless the active agent session's [`dsh-web-access`](../web-access/README.md) projection explicitly reports enabled. That separate, durable session decision applies only to these native public tools and is immediately revoked by `/web off`; it does not change the global approval policy or authorize other network paths. Without that session grant, only `allowed-once` proceeds. The request includes the complete queries or URL as plain JSON, plus the tool name and call id; this remains inspectable even when a client only renders shell arguments from the paired call. It duplicates those already-logged arguments in the local approval audit, not the session history or local file contents. Every later ungranted call, even an identical request or another call from the same agent, requires its own decision. Missing approval service or agent fails closed with `WEB_APPROVAL_REQUIRED`; refusal, cancellation, or unavailable answering yields `WEB_APPROVAL_DENIED`. A session with approval policy `never` rejects unless its user deliberately enabled this narrow Web grant. An abort prevents provider dispatch even if a late answer grants access. The cooperative tool timeout includes the approval wait.

Tool registration follows product **enablement**, not backend availability. A tool stays visible even when its selected provider is missing, misconfigured, ambiguous, or temporarily unavailable; the seam resolves the provider at execution time and execution fails with a structured `WebError` (e.g. `WEB_PROVIDER_UNAVAILABLE`, `WEB_PROVIDER_AMBIGUOUS`), which `ToolRuntime.execute()` turns into an error tool result the model can read and hooks/UI can route on. This keeps the model schema stable without making plugin load order, credential state, or HMR timing part of the model-facing contract. To remove a web tool entirely, disable it here in config.

The tool never calls a provider's `available()` and never enumerates providers — its only execution path is `ctx.web.search()` / `ctx.web.fetch()`, and provider unavailability reaches it as the structured `WebError` codes selection throws at execution time. Provider selection stays entirely inside the seam, with one owner.

## Model Experience

### System prompt

#### What the model sees

Search and fetch contribute the compact web-search and web-fetch guidance below. Search chooses its fetch-enabled or search-only text from config at registration time. Query limits remain both in the guidance and the tool schema. A scoped tool restriction does not remove these independently registered sections.

##### Web search guidance with fetch enabled

```markdown
Use web_search for current information. It accepts 1–4 non-empty search queries. Cite relevant source URLs as markdown links; use web_fetch when a result needs full content.
```

##### Web search-only guidance

```markdown
Use web_search for current information. It accepts 1–4 non-empty search queries. Use the returned source snippets when available and cite relevant source URLs as markdown links.
```

##### Web fetch guidance

```markdown
Use web_fetch for full text from a specific HTTP(S) URL; cite that URL as a markdown link.
```

#### Token effect

Fixed guidance cost per request for each config-enabled tool, even when a restriction hides its schema. Toggling fetch changes the search guidance and registers or removes the fetch section; `searchMaxQueries` changes the guidance and tool schema.

#### KV Cache effect

Prefix-stable while enabled tools, scope, and guidance text are unchanged. Config enablement—including toggling fetch's search-guidance branch—changing `searchMaxQueries`, or plugin lifecycle may invalidate reuse from the first changed prompt section; scoped schema restrictions do not remove it.

### Tool schemas

#### What the model sees

The model sees the generated [`web_search` and `web_fetch` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-web). Result-count and timeout budgets are deployment settings, not model arguments.

#### Token effect

Fixed schema cost per request for a resolved `searchMaxQueries`; config disablement removes both schema and guidance, while a scoped restriction removes only the schema.

#### KV Cache effect

Prefix-stable while definitions, resolved query cap, and visibility are unchanged. Config enablement, changing `searchMaxQueries`, plugin lifecycle, or scoped restrictions may invalidate reuse from the first changed schema token.

### Search result

#### What the model sees

The optional provider-owned answer is followed by `Sources:` and data-dependent lines shaped exactly `- [<title-or-url>](<url>)`, optionally suffixed ` — <snippet> (<publishedAt>)`. A multi-query call runs each exact query string once, preserving its first position; it labels each provider answer with the originating query as a markdown heading, deduplicates sources by URL, and takes one source at each rank from every query before advancing to the next rank. With neither answer nor sources the result says `No results found.` A capped list adds `(Showing the first <count> sources. Refine the query for more.)`; every result ends `Cite the relevant URLs above as markdown links in your answer.`

#### Token effect

Data-dependent results are resent until compaction; query fan-out is capped by `searchMaxQueries`, and sources are capped by `searchMaxResults`.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Search failure

#### What the model sees

If any query in a multi-query call fails, `web_search` aborts the other searches, waits for every started search to settle, discards successful results, and returns `Error: <message>` for the first failure.

#### Token effect

Only the retained error result adds tokens; discarded successful results do not enter model history.

#### KV Cache effect

Append-only; the error follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Fetch result

#### What the model sees

A successful fetch is exactly `Fetched <finalUrl> (HTTP <statusCode>)`, a blank line, and the provider-owned decoded body. Truncation adds a blank line and `(Content truncated. Fetch a more specific URL or section for the full text.)`; failures become `Error: <message>`. Queries and URLs remain in call history.

#### Token effect

Provider caps bound body size; retained call arguments and results are resent until compaction, and timeout policy can replace a late result with a short error.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument errors

#### What the model sees

Schema validation rejects an absent or non-array `queries` field and non-string array elements before execution. Value errors become exactly `Error: queries must contain at least one query`, `Error: queries must contain at most 1 query` when the configured cap is one, `Error: queries must contain at most <count> queries` for larger caps, `Error: each query must be a non-empty string`, or `Error: url must be a non-empty string`.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Outbound consent

#### What the model sees

An unapproved call produces `Error: Saída web bloqueada: aprovação não concedida (<outcome>). Não tente enviar os mesmos dados por outra ferramenta.` Missing approval routing produces `Error: Saída web bloqueada: não há canal de aprovação associado a esta chamada.` Caller cancellation or a tool deadline may replace that result with the executor's cancellation or timeout diagnostic. Successful result formatting and tool schemas are unchanged.

#### Token effect

Only a rejected call's retained error adds model tokens. Approval questions and decisions are audit events, not additional model input.

#### KV Cache effect

Append-only result changes; the approval policy adds no system-prompt section.

## Known Limitations and Deferred Work

- **There is no batch-wide native-search counter** — `searchMaxQueries` bounds `ctx.web.search` calls, but a provider may perform several native searches inside each call. For example, a model-backed provider configured with `maxUses` can permit up to `searchMaxQueries × maxUses` native searches; `searchMaxResults` limits only the combined sources returned to the caller. Deployments control cost through these independent consumer and provider settings because the generic seam does not know provider-internal search units.
- **HTML→markdown conversion degrades on inputs GFM cannot safely represent** — [turndown](https://github.com/mixmark-io/turndown) (with GFM tables/strikethrough) converts at most `fetchMaxOutputChars` source characters through a real DOM. A conservative 512-level lexical guard passes deeply or ambiguously nested bodies through as raw HTML, conversion exceptions do the same, and table `colspan` is ignored because GFM has no spanning-cell representation; these bounds avoid blocking the event loop or expanding output from an untrusted numeric attribute ([archived dependency decision](../../../.agents/notes/archived/simplification/2026-07-26-turndown-for-tool-web-html-markdown.md)).
- **The model-facing API is minimal by design, with promotions deferred** — `max_results` stays a config bound (not a model argument), and `web_fetch` takes only `url` (no `format`/`prompt`/LLM-summarization mode); both are named later steps in [the seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md).
- **Consent is not data-loss prevention or network isolation** — one-shot approval and the explicit per-session [`dsh-web-access`](../web-access/README.md) bypass cover only these native tools, not direct `ctx.web` callers, shell, browser, MCP, model-provider traffic, or trusted plugins replacing execution. They do not classify secrets, grant domains, constrain custom providers, or prevent a user from approving private data. Provider SSRF and redirect controls remain independently required. The [outbound consent decision](../../../.agents/notes/implemented/feature/2026-09-04-web-tool-outbound-consent.md) defines the base policy.
