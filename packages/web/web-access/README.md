# @deepseek-ai/dsh-web-access

English | [中文](README.zh.md)

`dsh-web-access` owns an explicit, durable **per-session** grant for the native `web_search` and `web_fetch` tools. It provides `ctx.webAccess`, folds the latest `web/access` event for a session, publishes the `webAccess` session projection when the projection registry is present, and registers `/web <on|off>` when the command runtime is present.

A new session starts with web access disabled. `/web on` appends `{ enabled: true }`; `/web off` appends `{ enabled: false }`; selecting the already-effective state does not add a duplicate event. The `dsh-tool-web` executor consumes the grant before requesting a one-shot approval. Therefore, an enabled session may use its native public search and fetch tools without repeat prompts; revoking the grant restores ordinary `egressPolicy: ask` behavior for the very next call.

## Scope and safety

The grant does **not** alter the file sandbox, shell, browser automation, MCP, credentials, global approval policy, other network-capable plugins, or direct provider callers. It is deliberately a narrow policy input for the two native web executors. The session event is local audit evidence, not a grant inherited by another session; a new session starts disabled even if an earlier one remains enabled.

`dsh-web-access` remains useful in a headless composition: the service can set and read session state without Commands or session projections. Without the service composed, `dsh-tool-web` keeps its ordinary per-call approval behavior.

## Model Experience

Indirectly, through the native `dsh-tool-web` approval path that consumes this session decision.

#### KV Cache effect

None; the service does not participate in provider requests or conversation assembly.

## Known Limitations and Deferred Work

- **Public tools only** — the grant does not authorize arbitrary Internet access, authenticated providers, browser automation, shell networking, or any extension outside the native `web_search` and `web_fetch` executors.
- **Session-local only** — a grant survives session replay for audit and immediate revocation, but it is not a default for future sessions and has no destination allowlist.
- **Provider policy remains authoritative** — fetch SSRF/redirect limits, provider credentials, availability checks, rate limits, and `egressPolicy: allow` deployments remain separate responsibilities.
