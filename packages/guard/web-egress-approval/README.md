---
description: "Tool guard that asks the user once per web_search or web_fetch call before anything leaves the machine, for maintainers composing Leon's network policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-egress-approval

English | [中文](README.zh.md)

## Summary

Host-mounted tool guard that turns every `web_search` and `web_fetch` call into an approval question before the tool body runs. The prompt shows the complete arguments, so the user sees the exact queries or URL, including parameters that may hold private data. A grant covers that one call; a rejection, a cancellation, a missing approval channel, or the `never` approval policy denies it, so the guard fails closed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it on the host next to `@deepseek-ai/dsh-user-approval`, so it covers every agent and subagent that composes the web tools:

```yaml
- id: web-egress-approval
  name: '@deepseek-ai/dsh-web-egress-approval'
  config:
    tools: [web_search, web_fetch]
    maxArgumentChars: 8192
```

| Field | Default | Meaning |
|---|---|---|
| `tools` | `web_search`, `web_fetch` | Tool names whose every call needs a one-shot approval |
| `maxArgumentChars` | `8192` | Bound on the serialized arguments shown in the prompt; longer arguments are truncated with a marker |

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin joins the registry's `tools/pre-execute` waterfall. It lets later listeners decide first and turns only an `allow` for a listed tool into an `ask` carrying the English reason and localized `displayReason` text (`en`, `zh`, `pt-BR`), each followed by the arguments. The registry resolves that ask through the approval service, which records the `approval/asked` and `approval/decided` audit pair in the session log. A denial or another policy's ask keeps its own meaning. The plugin adds no prompt text or tool schema and never wraps the tool body, so the upstream `tool-web` package stays unmodified.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the tool registry's approval outcome: a granted call returns the tool's normal result, and a refused call returns one registry error such as `the user rejected tool "web_search"`.

#### KV Cache effect

A denial is appended after the reusable request prefix, so it does not invalidate earlier KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No session-wide grant yet** — the fork's revocable per-session web access switch and its client control are not ported; every call asks.
- **Auto review answers asks** — when the optional Auto review integration is the session's permission preset, a reviewer model rather than the user may answer these questions; Leon's profile does not list that bundle.
- **Other egress paths** — shell, browser, and MCP tools are outside this guard; their approval belongs to the sandbox policy and a future MCP allowlist.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. The guard replaces the fork's `authorizeWebEgress` call inside `tool-web`'s executors with a pre-execute decision, which the 0.2.1 registry already routes through the approval service.

</details>
