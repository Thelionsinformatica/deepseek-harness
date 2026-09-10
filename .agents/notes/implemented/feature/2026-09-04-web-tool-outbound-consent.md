# Agent Note: One-shot outbound consent for native web tools

Status: implemented

English | [中文](2026-09-04-web-tool-outbound-consent.zh.md)

## Problem

A search query or URL can contain private workspace data even when the request only reads a public website. Filesystem confinement and permission to use an external model do not authorize that separate disclosure. A generic pre-execute listener can also be bypassed by an earlier listener returning `allow`.

## Decision

The [web tool consumer](../../../../packages/web/tool-web/README.md) owns `egressPolicy: ask | allow`. Its default is `allow`; the [Leon preset](../../../../apps/cli/config/agent-presets/leon/agent.cordis.yml) explicitly selects `ask`. Each tool executor requests a fresh, audited `allowed-once` decision after argument validation and before contacting `ctx.web`, unless the active session has an explicit narrow grant from [dsh-web-access](../../../../packages/web/web-access/README.md). That later user-facing grant is durable only for its session, applies only to the native public search and fetch executors, and `/web off` revokes it immediately; it does not change the global approval policy. The complete immutable arguments appear in the approval reason, because not all clients display non-shell paired arguments. Missing services, missing agents, disabled prompts, refusal, and unavailable answerers fail closed when no explicit session grant exists. Cancellation is checked again after awaiting the decision. The agent scheduler keeps interactive calls serial; approval time counts toward the cooperative tool timeout.

The existing [web approval channel](2026-07-23-web-permission-and-approval.md) remains the owner of user responses and the audit pair. The [web capability seam](../architecture/2026-06-24-web-capability-seam.md) retains provider selection, transport, and result normalization. Both decisions remain active; this policy adds consumer enforcement without replacing either mechanism.

## Alternatives considered

**Only a pre-execute listener.** An earlier listener can short-circuit that waterfall. Checking inside the actual native tool executor ensures an ordinary pre-execute `allow` is not outbound consent.

**Automatic secret detection.** Pattern matching cannot reliably distinguish public queries from private project context. Per-call review is conservative and costs interaction, but avoids treating a classifier as proof of privacy.

**Implicit session-wide or domain-wide grants.** A later request can disclose new content to the same destination. The base policy still grants only one call and never reuses a decision; the later `dsh-web-access` capability is a separate, explicit, visible per-session decision limited to these two native public tools, not an inferred or destination grant.

## Consequences

The prompt displays the actual outbound arguments and records them in local approval audit events as well as the existing tool call. Only per-call approved calls or a deliberately enabled `dsh-web-access` session grant reach providers; the model receives retained tool errors for denials without changing its static prompt or schemas. Existing generic consumers can explicitly retain unprompted web access.

This is not comprehensive data-loss prevention. Direct service callers, shell networking, browser automation, MCP, external model payloads, and trusted plugin replacement remain outside the policy. Custom providers and redirects retain their own security requirements. Headless sessions without an answerer cannot use guarded web tools, and interactive approval consumes the configured tool deadline.

## Verification

The focused executor suite covers both tools, all non-grant outcomes, absent approval routing, disabled prompts, repeated calls, cancellation with a late grant, argument validation, explicit allow mode, and disposal. The keyless [runnable example](../../../../examples/headless-agent/web-approval.cordis.yml) snapshot exercises the real Loader, agent loop, approval service, tool execution and session log; scripted model, user responses and network providers are the only replacements. Synthetic private canaries never reach the recorded provider requests. Live browser interaction and real paid-provider behavior are separate validation work.
