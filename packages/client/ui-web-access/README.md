# @deepseek-ai/dsh-client-ui-web-access

English | [中文](README.zh.md)

Browser-side composer control for [`dsh-web-access`](../../web/web-access/README.md). The plugin occupies the existing session-scoped `conversation.input.right` list slot with a compact **Web** button. Its pressed state comes only from the Host-projected `webAccess.enabled` value; it does not maintain an optimistic permission copy.

Selecting the button sends `/web on` or `/web off` through the commands Remote for the exact current session. The Host event then updates the projection and therefore the button state. During a request the button is disabled; an RPC or command refusal shows a generic local failure instead of transport details. When the host `webAccess` projection is absent, the control renders nothing, allowing the same browser bundle to run against compositions that do not include the feature.

The button label and tooltip deliberately name only native public Web search and fetch. It does not suggest general browser, shell, credential, or unrestricted Internet control.

## Model Experience

Indirectly, through the Host `/web` command that changes the `dsh-web-access` decision consumed by `dsh-tool-web`.

#### KV Cache effect

None; UI interaction does not alter provider requests or conversation assembly.

## Known Limitations and Deferred Work

- **No autonomous research workflow** — enabling the capability permits subsequent native tool calls but does not cause the model to search automatically or choose a number of sources.
- **No global default** — the button changes only the active session; opening a new session begins with Web access disabled.
- **Host availability required** — a disconnected or older host can reject the command; the visible state remains the last projection until the next successful Host update.
