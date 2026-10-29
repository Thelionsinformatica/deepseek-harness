# Agent Note: A content guard for tool output

Status: implemented

English | [中文](2026-10-29-tool-output-content-guard.zh.md)

## Problem

Every tool result is an untrusted input channel: a `web_fetch` page, a third-party MCP server, or a file outside the workspace can carry text that reads like instructions, and a model can follow it. The harness had no inspection at that boundary — the closest mechanisms are credential storage protection, sandboxing, and the client-side secret mask, none of which look at what a tool returns. Comparable harnesses ship a dedicated content-defense capability (prompt-injection and PII scanning) as an always-on layer.

## Decision

[`dsh-content-guard`](../../../../packages/guard/content-guard/README.md) installs one listener on the `tools/post-execute` waterfall. It scans the content that will actually reach the model — honoring a downstream content replacement — for two fixed rule families: instruction-shaped text (`instruction-override`, `behaviour-override`, `role-hijack`, `prompt-exfiltration`, `chat-template`, `turn-spoofing`) and credential-shaped secrets (`private-key`, `jwt`, `cloud-api-key`, `service-token`). A flagged result gains one injected `user/message` notice naming the matched rule identifiers and telling the model to treat the output as data.

The guard is advisory by default and never blocks. It also never rewrites instruction-shaped text: hiding the evidence would contradict the warning. An opt-in `redact` mode replaces detected secrets with `[redacted:<rule>]` in the model-facing content, for deployments that must not let a credential reach the model at all; it is skipped when a downstream listener replaces the result value, because that value owns the projection.

The notice uses a new injected-message source kind (`content-guard`) with `form: 'notice'`, so the model-visible warning is reconstructable from the session log. No new Session event type is introduced: the notice rides the existing injected `user/message` channel, and no persistence acknowledgement is needed.

Scanning is bounded by `maxScanChars` (default 65,536) across the result's text blocks, so cost is independent of payload size. Diagnostics carry rule identifiers only; a matched secret never appears in the notice or the host log.

## Alternatives considered

**Block the call when content matches.** Rejected: a heuristic match is not evidence of malice, and the value of the result is often exactly the page that discusses instructions. Blocking turns false positives into failed tasks; an advisory notice keeps the model in control.

**Rewrite all flagged content.** Rejected: redacting instruction text destroys the evidence the warning is about, and rewriting normal text breaks tools whose output must round-trip.

**Ship an ML classifier.** Deferred: the package must stay dependency-free and predictable, and rule identifiers are auditable. A classifier can later replace or supplement `matchingRules` behind the same notice contract.

**Add PII heuristics now.** Deferred: names, addresses, and numbers appear in ordinary engineering work, so the false-positive cost is higher than the current evidence of need. Secret formats and instruction phrasing carry clearer signal.

## Consequences

- A deployment that reads prompt-injection examples draws a notice on every such read.
- Paraphrased instructions that match no rule pass unflagged.
- The guard adds one message per flagged result, roughly 45 tokens, and no tokens otherwise.
- Redaction changes model-facing content for secrets only; the session log records the redacted content, so the model-visible value stays reconstructable.

## Verification

- `vitest run packages/guard/content-guard` — 11 tests cover clean output, annotation, secret detection without echo, redaction, `redact` leaving instruction text alone, toggles, the scan bound, include/exclude scope, downstream block preservation, fail-loud config, and the named plugin surface.
- `pnpm run typecheck` passes all five gates and `pnpm run lint` reports no errors.
- `pnpm run gen-config-catalog` records the plugin's config schema in the generated catalog, and the package README pair carries the model-experience, limitation, and token-effect contracts.
