# LEON-EVAL-PTBR

English | [中文](leon-eval-ptbr.zh.md)

## Purpose

LEON-EVAL-PTBR is the executable, keyless Memory V2 phase gate for continuity, safety, isolation, governance, local-first routing, and optional semantic retrieval. Every scenario uses Brazilian Portuguese input where language affects behavior and points to an exact deterministic Vitest case instead of duplicating a second fixture implementation.

## Run the evaluation

```sh
pnpm run test:leon-eval
```

The coordinator runs the canonical scenario evidence three times with one worker, captures test duration and heap diagnostics, and writes a sanitized report to `.artifacts/leon-eval-ptbr/latest.json`. `--runs N` accepts three or more repetitions, and `--output <path>` selects another report file.

The command exits non-zero when evidence is missing, any scenario fails, precision or recall changes between the three baseline runs, a critical scenario fails, or the p95 resource limits are exceeded. It does not require Ollama, Gemini, OpenAI, or another API key.

## Executable scenario set

The canonical registry in [`scripts/leon-eval-ptbr-model.ts`](../../scripts/leon-eval-ptbr-model.ts) owns these scenarios and their exact test evidence:

1. Retain with `memory_remember` and retrieve in the same session.
2. Retrieve an explicit memory in a second session of the same workspace.
3. Restart the local provider and preserve durable records.
4. Never read or mutate across a workspace boundary.
5. Never authorize automatic storage for another user.
6. Correct an exact memory revision.
7. Reject a stale revision conflict.
8. Forget a confirmed memory.
9. Reject a credential in `memory_remember`.
10. Reject a credential in administrative correction.
11. Omit credential-like search text from recall and audit telemetry.
12. Present automatic recall only as non-instructional context.
13. Do not inject unrelated memory for an irrelevant PT-BR message.
14. Keep a shadow suggestion out of durable memory.
15. Distinguish a stable fact from a suggestion and hypothesis.
16. Distinguish a decision and preference.
17. Preserve revision history.
18. Reject extraction without a registered workspace.
19. Exclude superseded revisions from active retrieval.
20. Preserve contradictory history while activating the replacement.
21. Block automatic writes without complete user and workspace consent.
22. Enforce the hard recall-context budget.
23. Give the external routing preflight numeric facts only, never prompt or memory content.
24. Keep stored prompt injection inside an untrusted-data envelope.
25. Select the lightweight local Qwen tier for short conversation.
26. Raise local reasoning effort for medium technical work.
27. Fail closed when external routes are denied.
28. Retrieve a paraphrase through the optional local semantic path.
29. Never send another workspace's memory to the semantic endpoint.
30. Fall back to lexical recall when the semantic Ollama endpoint is unavailable.
31. Keep semantic retrieval opt-in until a deployment accepts the benchmark.

Scenarios 4, 5, 23, 24, and 29 are critical. Any failed or missing evidence for one of them is reported separately as a hard failure.

## Metrics

- **Oracle precision** is the pass rate of all scenarios tagged with deterministic expected output.
- **Recall@k** is the pass rate of recall scenarios; their evidence asserts the expected hit, omission, ranking, or fallback at the configured bound.
- **False-discovery rate** is the failed-oracle rate, and **recall false-positive rate** is the failure rate of explicit irrelevant-input scenarios.
- **Cross-workspace, cross-user, and sensitive-data leakage rates** are the failure rates of their security scenario families; the accepted value is zero.
- **Confirmation, rejection, cloud-consent, and prompt-injection rates** are pass rates of the corresponding policy families.
- **p50 and p95 latency** sum the exact evidence durations per scenario. The default p95 target is 2,000 ms.
- **p50 and p95 heap** use Vitest's per-test heap diagnostic. The default p95 target is 512 MiB; the report also records process RSS per run.

The report contains scenario ids, PT-BR titles, pass/fail status, durations, and resource counters. It contains no prompt, memory content, workspace id, user id, credential, model response, or failure stack.

## Advancement criteria

- At least three complete baseline runs.
- All scenario evidence present and passing in every run.
- Stable oracle precision and Recall@k across the baseline runs.
- Zero critical failures and zero workspace, user, sensitive-data, or unauthorized-cloud leakage.
- p95 latency and heap within their local targets.

## Interpretation limits

The keyless suite evaluates Leon's deterministic runtime, local provider, Loader composition, safe context, and routing decisions. The routing scenarios prove which configured route and effort Leon selects; they do not claim model-answer quality. Semantic scenarios use a controlled loopback endpoint, so real Ollama cold-start, GPU throughput, and embedding quality still require a deployment-specific hardware run before semantic retrieval becomes a shipped default.
