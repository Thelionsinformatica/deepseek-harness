# Agent Note: Explicit Web access and conservative Plugin Center controls

Status: implemented

English | [中文](2026-09-06-explicit-web-access-and-plugin-center.zh.md)

## Problem

The Leon profile made native Web calls safe by asking for outbound consent, but a deliberate user choice to research during one session still required a prompt for every search or fetch. The unrelated filesystem “Full access” selector could appear to promise Internet capability even though it was neither a Web grant nor a reversible session decision.

The existing plugin inventory exposed only Loader identity and status. Users could not tell what a plugin did, whether a switch was safe, or why a control was unavailable. Turning the inventory into a generic Loader editor, however, would make browser RPC able to persist arbitrary package configuration or disable host, session, security, and transport infrastructure.

## Decision

### Explicit native Web grant

[`dsh-web-access`](../../../../packages/web/web-access/README.md) owns a `web/access` session event, a `webAccess` projection, and `/web on|off`. A new session folds to disabled. Enabling records a local, durable, auditable decision; disabling records revocation and immediately restores the normal behavior of [`dsh-tool-web`](../../../../packages/web/tool-web/README.md). When `egressPolicy` is `ask`, the native `web_search` and `web_fetch` executors skip one-shot approval only while their exact active session is enabled. The browser-side [`dsh-client-ui-web-access`](../../../../packages/client/ui-web-access/README.md) button uses the projection as its sole state source and names that narrow scope.

The grant does not modify `ApprovalPolicy`, filesystem sandbox scope, browser automation, shell networking, MCP, credentials, direct providers, or any other network-capable plugin. It is not inherited by a new session and is not a general Internet permission. It extends, rather than replaces, the default per-call policy recorded by the [outbound consent decision](2026-09-04-web-tool-outbound-consent.md).

### Conservative Plugin Center

[`dsh-host-plugin-inventory`](../../../../packages/host/plugin-inventory/README.md) classifies current non-group Loader entries with safe inferred category, summary, capability, and management metadata. Its `liveToggleEntries` deployment allow-list pairs each stable configuration id with an exact public module identity and defaults empty. Structural Loader groups, local or URL-shaped identities, and protected core/session/security/transport entries take precedence over that allow-list; all unlisted entries are `restart-required` and remain inspection-only.

The `setEnabled` Remote accepts only an exact allow-listed, non-protected entry and invokes `Entry.update()` directly. It does not invoke `ctx.loader.update()` and therefore does not write profiles, bundles, included trees, or user patches. The change lives only in the running process and is lost at restart. [`dsh-client-ui-settings-plugin-inventory`](../../../../packages/client/ui-settings-plugin-inventory/README.md) presents that classification and renders an action only for a Host-returned `live-toggle` entry; its state is replaced only by the Host response.

## Alternatives considered

**Treating Full access as Web access.** Rejected because sandbox scope answers filesystem confinement, not public Internet disclosure. Making that selector silently change egress would couple unrelated capabilities and leave neither a clear audit event nor an immediate session revocation.

**Changing the global approval policy to allow.** Rejected because a global grant would affect unrelated approval channels and turn a session-scoped user decision into a durable default. The narrow event leaves every non-Web approval path unchanged.

**One switch for every Loader entry.** Rejected because the Loader contains composition, transport, session, security, and core entries whose loss can break the host or its recovery path. A conservative deployment allow-list makes the operator, not a browser client, choose the limited optional entries eligible for runtime toggling.

**Using `ctx.loader.update()` for the action.** Rejected because it participates in Loader tree persistence. Direct `Entry.update()` keeps a switch reversible by restart and prevents a UI click from writing any deployment or user configuration.

## Consequences

A user can visibly enable native public search and fetch once for the current session, then turn it off without a restart. The default remains conservative, replay retains the decision for local audit, and a new session begins disabled. This does not establish a data-loss-prevention system: query contents can still be sensitive, provider policy and redirect controls remain separate, and the grant never covers arbitrary networking.

The Plugin Center provides useful operational detail without exposing secret-bearing configuration. Only `web-search-google` and `web-fetch-http` are configured as live-toggle examples in the Leon web-app bundle; their state change never persists. A plugin that needs a durable configuration change must use its owning deployment mechanism and restart after review.

## Verification

Focused host and client suites pin the default-disabled Web state, session event folding, command decisions, projection teardown, ask-policy bypass only while granted, and immediate revocation. They also pin Plugin Center metadata, generated Remote methods, exact allow-list enforcement, protected-entry rejection, process-local no-write toggles, display state replacement, and absence of actions for unlisted entries. Host and client library builds type-check both new packages and regenerate the Remote contract. The final assembled Web build and live GUI check remain the integration evidence for this feature.
