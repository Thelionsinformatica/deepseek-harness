# LEON-ACCEPTANCE-7

English | [中文](leon-acceptance-7.zh.md)

## Purpose

LEON-ACCEPTANCE-7 is the executable product-acceptance reference for seven Leon capabilities: restart continuity, long-horizon decision retrieval, exact Windows and workspace targeting, evidence-gated completion, reviewed-procedure reuse, local-model execution, and transparent API-cost accounting. The canonical registry in [`scripts/leon-acceptance-7-model.ts`](../../scripts/leon-acceptance-7-model.ts) maps each capability to exact Vitest evidence and fails closed when that evidence is absent, skipped, renamed, partial, or failing.

## Prerequisites

- Use Windows with `pwsh`; the UI Automation evidence is Windows-native and is skipped on other platforms.
- Run Ollama on the literal loopback endpoint `http://127.0.0.1:11434`, or set `LEON_ACC_006_OLLAMA_URL` to an HTTP URL on `127.0.0.1` or `[::1]` without embedded credentials.
- Make the exact Ollama model ids `qwen3.5:9b` and `ornith-1.5:9b` available. The evaluation does not substitute aliases or another quantization tag.
- Install the repository dependencies before starting the evaluation.

Confirm the local model ids before a run:

```sh
ollama list
```

## Run the evaluation

```sh
pnpm run test:leon-acceptance
```

The coordinator executes the registered evidence three times with one Vitest worker and no file parallelism. Each repetition enables the real loopback-only Ollama benchmark, which runs 30 fixed PT-BR microtasks: 22 through `qwen3.5:9b` and eight through `ornith-1.5:9b`. The minimum evaluation therefore performs 90 local model inferences.

Use `--runs N` for at least three repetitions and `--output <path>` to select the aggregate report path:

```sh
pnpm run test:leon-acceptance -- --runs 5 --output .artifacts/leon-acceptance-7/manual.json
```

## Execution safeguards

- The child process removes `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `NVIDIA_API_KEY`, `OMNIROUTE_API_KEY`, and `OPENAI_API_KEY` from its inherited environment.
- The real-model benchmark accepts only an unauthenticated HTTP loopback Ollama endpoint and rejects an external host before dispatch.
- The routing-policy evidence rejects every initial provider other than Ollama before an adapter can run.
- Vitest output and failure details are not copied into the aggregate artifact; temporary per-run reports are deleted after aggregation.

## Seven criteria

| ID | Product claim | Executable evidence boundary | Critical |
|---|---|---|---|
| LEON-ACC-001 | Resume a pending task after a runtime restart while changing the selected model. | Recreates the agent over the same durable session and proves that only the pending task continues through the replacement model. | Yes |
| LEON-ACC-002 | Find the correct decision months later. | Retrieves one 150-day-old decision ahead of newer distractors in a new session. | Yes |
| LEON-ACC-003 | Operate the intended window and workspace without confusing similar targets. | Requires an exact window identity and process allowlist, and separately requires matching workspace id and canonical path ownership. | Yes |
| LEON-ACC-004 | Test and prove changes before declaring completion. | Requires an all-completed task list, a fresh structured audit, a digest tied to the reviewed parent log, and rejection of tampered or stale evidence. | Yes |
| LEON-ACC-005 | Learn a reviewed successful tool procedure and reuse it after a model switch. | Persists a candidate only from a successful `tool/call` plus matching successful `tool/result`; human approval binds an exact command before promotion or reuse, then a new session and model retrieve and execute the real step and verifier under durable preconditions and revalidation state. | No |
| LEON-ACC-006 | Use local models for representative PT-BR tasks. | Proves 30 initial Ollama routes and validates 30 real loopback model answers against exact microtask oracles in every repetition. | No |
| LEON-ACC-007 | Show confirmed, token-estimated, and unaccounted cost separately. | Projects provider-reported charges, configured token estimates, unknown calls, and retry/failover attempts independently and verifies their StatsLine presentation. | Yes |

## Artifacts and confidentiality

The coordinator atomically writes `.artifacts/leon-acceptance-7/latest.json` by default. It contains runtime metadata, the list of removed credential keys, run count, stability, criterion statuses, evidence identities, durations, named gaps, and missing or failed evidence. It contains no prompts, model responses, session content, credentials, stack traces, workspace paths, or window contents.

The real Ollama evidence separately writes `.artifacts/leon-acc-006/local-real-latest.json`. That artifact contains task ids, selected local route, pass status, latency, token counts, error code, and a SHA-256 digest of each normalized answer; it does not retain the prompt or answer text.

## Result semantics

A criterion is `passed` only when every mapped test passes in every repetition, at least one mapped test is decisive, and the registry names no remaining gap. Missing, skipped, pending, or failed evidence makes the criterion `failed`; supporting-only evidence or a named gap makes it `partial`. The aggregate is approved only after at least three stable repetitions with all seven criteria passed and no partial criterion.

Exact file and test-name mappings are intentional. Renaming or removing evidence without updating the reviewed registry produces missing evidence instead of silently weakening the claim. When the decisive case `learns reviewed successful tool evidence and reuses exact steps after a model switch` is registered and passes, LEON-ACC-005 no longer remains partial: the case proves the explicit candidate, review, persistence, model-switch retrieval and verified execution, and revalidation flow.

## Interpretation limits

The 30 Ollama cases are deterministic, single-answer microtasks. They prove local routing and constrained response quality, not a long autonomous Leon workflow that inspects a project, edits files, invokes tools, recovers from failures, and validates the final result.

The cost projection distinguishes a provider-reported amount, a configured token-price estimate, and activity without sufficient cost evidence. It does not query or reconcile a provider invoice, account ledger, taxes, credits, negotiated rates, or charges that the provider did not report.

Procedure candidacy is explicit rather than automatic, and Leon has no dedicated review screen yet. Those are usability and automation limits, but they do not invalidate the decisive proof of the explicit reviewed-procedure flow.

UI Automation evidence depends on native Windows accessibility and PowerShell behavior. A non-Windows run skips that decisive case and therefore cannot approve LEON-ACC-003 or the complete aggregate.

The three repetitions expose missing evidence and run-level instability under one serialized test configuration. They do not establish long-duration reliability, cross-hardware performance, or freedom from model-output variance after a model or quantization change.

The testing decision and rejected alternatives are recorded in the [LEON-ACCEPTANCE-7 Agent Note](../../.agents/notes/implemented/testing/2026-08-26-leon-acceptance-7.md).
