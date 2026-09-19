# Agent Note: Keyless LEON-EVAL-PTBR phase gate

Status: implemented

English | [中文](2026-08-25-keyless-leon-eval-ptbr.zh.md)

## Problem

Memory V2 had strong package and composition tests but no single reproducible phase decision. The evidence was spread across storage, tool, Loader, context-composition, routing, and bundle suites; it reported neither three-run stability nor a common latency and memory budget. A second handwritten benchmark implementation would drift from production tests, while a required live-model run would add model variance, credentials, cost, and hardware dependence to an isolation and privacy decision.

## Decision

[`scripts/leon-eval-ptbr-model.ts`](../../../../scripts/leon-eval-ptbr-model.ts) owns 31 named PT-BR scenarios and maps each one to exact existing Vitest evidence. The registry adds dedicated cases only where the evidence inventory lacked cross-session continuity, irrelevant-query recall, or fact-versus-suggestion classification. Workspace and user isolation use independent fixture identities and exact allowlists; cloud scenarios inspect content-free routing facts and explicit external policy instead of sending a request.

`pnpm run test:leon-eval` executes the required evidence three times with one worker. A custom reporter retains only file and test identity, state, duration, Vitest heap diagnostics, and process RSS. The coordinator rejects malformed reports, missing evidence, incomplete baseline counts, scenario failures, unstable oracle or recall rates, and resource p95 values above 2,000 ms or 512 MiB. It writes the sanitized aggregate to the ignored `.artifacts/leon-eval-ptbr/latest.json` path.

Scenarios for cross-workspace isolation, cross-user authorization, content-free external routing, prompt-injection containment, and semantic prefiltering are critical. Their failures remain separately visible and always fail the command. All other scenario failures also fail the phase; the critical label prevents a future aggregate policy from treating security evidence as an ordinary score trade-off.

The keyless result certifies deterministic Leon behavior, not model-answer quality or local GPU throughput. Routing cases prove the chosen configured tier and effort. Semantic cases use a controlled loopback endpoint. The shipped semantic switch remains off until a deployment-specific live Ollama run establishes cold-start, throughput, and embedding quality on the target machine.

## Alternatives considered

**Create a separate end-to-end benchmark implementation for all scenarios.** Rejected because duplicated storage, recall, and policy fixtures could disagree with the package and real-Loader tests that already enforce the shipped behavior.

**Require Ollama, Gemini, or OpenAI for the phase gate.** Rejected because provider availability, changing model output, credentials, cost, and host hardware would make isolation and privacy acceptance nondeterministic. Live model quality remains a separate deployment profile.

**Accept one successful run.** Rejected because one pass cannot reveal unstable evidence selection or resource variance. Three sequential baselines are the minimum accepted result.

**Publish prompts and failures in the report for debugging.** Rejected because an evaluation of privacy must not create another store for memory content, user data, workspace identities, credentials, or model responses.

## Consequences

Memory V2 has one repeatable command with hard-fail security semantics and quantitative local evidence. Exact test-name mappings intentionally fail when evidence is renamed or removed, forcing the scenario registry and its meaning to be reviewed together. The suite reuses mature tests and therefore runs quickly without APIs, but its latency and heap figures measure deterministic operations and test harness overhead rather than end-user model latency. A live hardware profile remains required before enabling semantic retrieval by default.
