---
description: "Session-scoped user grant for the native web tools, for maintainers composing Leon's web consent."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-access

English | [中文](README.zh.md)

## Summary

Host service that records one explicit user decision per session: whether the native `web_search` and `web_fetch` tools may run without a per-call approval. The decision is a durable `web/access` session event, starts disabled, and can be revoked at any time with `/web off` or the composer Web button. It does not contact the web, change the sandbox, or alter global approval presets; the `dsh-web-egress-approval` guard reads it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it on the host next to the egress guard; `dsh-client-ui-web-access` adds the composer button:

```yaml
- id: web-access
  name: '@deepseek-ai/dsh-web-access'
```

`/web` reports the current state, `/web on` grants web access for the session, and `/web off` revokes it. Repeating the current value appends nothing, so the log is an audit of real decisions.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`src/index.ts`](src/index.ts) registers the `webAccess` session projection, which folds the latest `web/access` event and is exposed to clients through its wire view, and the `/web` command when a command runtime is composed. `ctx.webAccess.isEnabled(session)` reads the projection; `set` appends a new event only when the value changes.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the web egress guard: the grant adds no prompt text or tool schema and only decides whether the guard asks before a web call.

#### KV Cache effect

None; switching the grant changes no request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Native web tools only** — shell, browser, and MCP traffic are outside this grant.
- **Per session** — a new session starts disabled; there is no global default.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. Ported from Leon's fork, where the egress check lived inside `tool-web`; on 0.2.1 the check is the separate `dsh-web-egress-approval` guard and the state is a session projection instead of a synchronous history fold.

</details>
