# Agent Note: Fail-closed LEON-ACCEPTANCE-7 product evidence

Status: implemented

English | [中文](2026-08-26-leon-acceptance-7.zh.md)

## Problem

Leon had package-level evidence for continuity, memory, workspace isolation, Windows automation, completion governance, local routing, and cost presentation, but those tests did not answer one product question together: whether the seven requested capabilities were all proved at the same revision. An informal review could treat a passing microtest as proof of a long autonomous workflow, ignore skipped Windows evidence, call an estimated cost exact, or expose credentials and model content while collecting diagnostics. A live cloud-model acceptance would also add provider availability, cost, and mutable output to claims that can be decided locally.

## Decision

[`scripts/leon-acceptance-7-model.ts`](../../../../scripts/leon-acceptance-7-model.ts) owns seven named product criteria and maps each claim to exact existing Vitest cases. Evidence is marked decisive or supporting, criteria are marked critical or noncritical, and named coverage gaps force `partial` even when their executable evidence passes. Missing, skipped, pending, renamed, or failed evidence forces `failed`; exact test identity makes weakening the proof require an explicit registry review.

`pnpm run test:leon-acceptance` runs the complete evidence inventory three times with one worker and no file parallelism. The aggregate passes only when every criterion passes in every repetition, the run outcomes are stable, at least three repetitions exist, and no criterion remains partial. A child-test failure also makes the command exit unsuccessfully even when the sanitized aggregate cannot represent that failure as mapped evidence.

The local-execution criterion enables the real loopback Ollama profile on every repetition. It verifies 30 fixed PT-BR microtask answers through the exact `qwen3.5:9b` and `ornith-1.5:9b` ids, for 90 minimum local inferences, while the routing sentinel rejects an external provider before adapter dispatch. The complete product decision runs on Windows because its exact-window UI Automation evidence is native and skipped elsewhere.

LEON-ACC-005 uses the decisive case `learns reviewed successful tool evidence and reuses exact steps after a model switch`. A procedure candidate can contain only a successful `tool/call` plus its matching successful `tool/result` and may be persisted with candidate status before review; human review approves one exact command before promotion or reuse. A new session running a different model then retrieves and executes the real step and verifier under the durable preconditions and revalidation state.

The operational procedure, seven evidence boundaries, model prerequisites, and result semantics live in the [LEON-ACCEPTANCE-7 reference](../../../../docs/evals/leon-acceptance-7.md).

## Evidence and confidentiality

The coordinator removes the supported DeepSeek, Gemini, Google, NVIDIA, OmniRoute, and OpenAI credential environment keys before starting Vitest. The real-model test accepts only an unauthenticated HTTP endpoint on `127.0.0.1` or `[::1]`. A content-free reporter records test file, exact test name, state, duration, optional heap use, and process RSS into temporary reports that are deleted after aggregation.

The durable aggregate contains criterion identity, status, duration, named gaps, and missing or failed evidence, not prompts, responses, sessions, window contents, credentials, or error stacks. The separate local Ollama artifact stores normalized-answer SHA-256 digests and numeric task evidence instead of answer text. Both artifacts are diagnostic evidence, not a new memory or transcript store.

## Interpretation limits

The local benchmark exercises constrained single-answer inference and exact oracles; it does not execute the Leon agent loop, tools, file edits, autonomous recovery, or final project validation. It therefore supports the local-model criterion without claiming equivalence to a long ChatGPT Work-style task.

Session cost tests distinguish a provider-reported nanodollar amount, an estimate derived from configured token prices, and calls or retry/failover attempts without sufficient accounting evidence. They do not reconcile invoices, account ledgers, credits, taxes, negotiated prices, or omitted provider charges.

Procedure candidacy is not yet automatic and there is no dedicated review screen. Those are automation and usability limitations, not a missing proof in the explicit candidate-and-approval flow covered by LEON-ACC-005.

Three serialized repetitions detect missing evidence and repeated-run disagreement at the test-result level. They do not establish soak reliability, model stability after changing weights or quantization, or equivalent latency across hardware. Windows UI Automation remains a platform requirement rather than a portable simulation.

## Alternatives considered

**Accept one successful evidence run.** Rejected because one pass cannot expose a skipped platform case, a transient local-model result, or an unstable evidence inventory. Three sequential repetitions provide the minimum repeated observation without parallel contention.

**Use Gemini, OpenAI, or another cloud model as the acceptance judge.** Rejected because credentials, cost, provider availability, and mutable model judgment would make the result neither local nor reproducible. Cloud credentials are removed rather than merely left unused.

**Prove local-model use through routing fixtures only.** Rejected because a classifier decision does not prove that the selected local models can answer the representative corpus. The real Ollama profile adds constrained answer evidence while keeping dispatch on loopback.

**Treat the 30 local microtasks as proof of complete autonomous execution.** Rejected because the corpus invokes neither tools nor an end-to-end agent workflow. The limitation stays explicit instead of inflating the local inference result.

**Store raw prompts, answers, and failure stacks for diagnosis.** Rejected because the acceptance process must not create another repository of user content, credentials, model responses, or machine state. Hashes, counters, evidence identities, and stable error codes are sufficient for the decision.

## Consequences

Leon has one reproducible command that evaluates all seven claims and refuses approval when any proof is partial, absent, skipped, or failing. The exact-name registry is intentionally coupled to test meaning, so legitimate refactors must update the evidence decision instead of inheriting a silent pass. The minimum run is comparatively expensive because it performs 90 local inferences and requires Windows plus two exact Ollama model ids, but it incurs no cloud API charge and emits sanitized, reviewable artifacts.

When its decisive model-switch case is present and passes in every repetition, LEON-ACC-005 no longer contributes a partial result. Automatic candidate creation and a dedicated review screen remain future product improvements, while exact-command approval, verified cross-session execution, durable preconditions, and revalidation are part of the proved explicit flow.
