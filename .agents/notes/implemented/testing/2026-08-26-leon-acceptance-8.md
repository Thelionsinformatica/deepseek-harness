# Agent Note: Host-verified long autonomous Leon benchmark

Status: implemented

English | [中文](2026-08-26-leon-acceptance-8.zh.md)

## Problem

LEON-ACCEPTANCE-7 proves seven product boundaries with deterministic package tests and constrained local-model microtasks. Those cases do not prove that a real Leon runtime can plan a project change, inspect and edit multiple files through its tools, execute tests, recover from a defect, and produce completion evidence that survives an independent oracle. Treating a scripted controller that asks an LLM for JSON actions as Leon autonomy would be a false positive: the controller, rather than AgentLoop and ToolRuntime, would own execution. Trusting a journal or completion receipt inside the model-writable workspace would let the subject fabricate its own evidence.

A cloud judge would add credentials, cost, mutable provider behavior, and accidental content transfer. A visible in-workspace hidden test would leak the diagnosis target. Raw session retention would create a second store of prompts, source, tool results, and local paths merely to answer a pass/fail question.

## Decision

[`scripts/run-leon-acceptance-8.ts`](../../../../scripts/run-leon-acceptance-8.ts) runs two fresh, real `headless` Leon compositions against one isolated fixture. The first exact local model owns planning, file inspection, multi-file implementation, and visible test execution. A host-owned oracle outside the workspace must pass before the host injects one canonical rounding regression. The same oracle must then fail. A second fresh composition, using another exact local model over the existing fixture, owns diagnosis, repair, and visible test execution; the host oracle must finally pass.

The controller owns only fixture setup, local-model availability checks, process and time bounds, fault injection, hidden-oracle execution, session-log projection, final evaluation, cleanup, and artifact publication. It never translates model prose into file edits or commands. Leon's actions cross the real AgentLoop, ToolRuntime, filesystem, todo, and shell services. The accepted shell surface is exactly `node --test`; all file changes use Leon's native tools.

[`scripts/leon-acceptance-8-model.ts`](../../../../scripts/leon-acceptance-8-model.ts) is the fail-closed evidence owner. It requires the first call to be a five-item-or-larger `todo_write`, at least two changed required source files, successful model-executed tests in both stages, a recovery test failure followed by a later passing test, local route evidence, a canonical injected source hash, oracle source hashes equal to the exact phase source hashes, a detected injected failure, a changed repaired source, and a passing final oracle. Protected file hashes, unexpected entries, outside-workspace file references, unknown tools, and any shell command other than the exact test command are rejection inputs rather than warnings.

Each stage has one-turn, model-step, tool-call, token, and wall-clock budgets. The process timeout is an active host bound; event-derived limits fail the report if the completed session exceeded them. The deterministic unit suite exercises endpoint confinement, content-free event projection, fixture fail/pass behavior, complete positive evidence, and adversarial binding or policy failures without invoking a model or external API.

## Isolation and evidence ownership

The runtime child receives an environment allowlist. External credential and proxy variables are not inherited. Its invocation directory and DSH home are new temporary directories, so project and user `.env` layers do not import the operator's API configuration. The ephemeral overlay declares exactly one Ollama provider and model, disables settings and credential mutation, and removes web, jobs, skills, code runtime, goals, workflows, Ralph, OpenCode, and in-process subagents.

The hidden oracle is stored outside the session workspace and is never named in the prompt. The workspace sandbox confines mutation, while evidence projection also rejects filesystem arguments that resolve outside the fixture. The subject cannot satisfy completion by writing `.json`, JSONL, or another receipt: only host-observed durable events, host-run oracle exit codes, and host-computed hashes enter the decision.

The runner deletes the fixture, DSH homes, hidden test, and raw transcripts before atomically writing the result. The durable artifact contains stable failure codes, counters, timings, model identities and digests, relative source names, event sequence numbers, and SHA-256 hashes. It excludes prompts, model responses, source text, tool arguments and results, absolute temporary paths, hidden-test text, credentials, and stacks.

## Alternatives considered

**Use a JSON action interpreter outside Leon.** Rejected because it benchmarks an LLM plus a bespoke controller. The controller would choose and execute filesystem and test operations, bypassing the Leon services whose autonomy is the claim.

**Keep a model-written execution journal or completion file.** Rejected because any file inside the writable fixture can be forged, reordered, or changed after the last passing test. Host-side durable events and oracle hashes are not writable by the subject and bind evidence to source state.

**Tell the model which file and defect to repair.** Rejected because that measures choreography. The recovery prompt reports only that verification found a regression; the visible test and current source are the model's diagnostic inputs.

**Count the first visible test pass as completion.** Rejected because the model could edit after the pass or satisfy only exposed cases. A protected hidden oracle runs after each relevant source state, and the final pass is digest-bound.

**Run Gemini, OpenAI, OmniRoute, or an LLM judge.** Rejected because external credentials, cost, network state, and mutable judgment are unnecessary. Both subject models and every inference remain on literal loopback Ollama.

**Claim arbitrary long-horizon autonomy from this fixture.** Rejected because one staged order-summary task cannot support that conclusion. The benchmark is explicitly a bounded fault-injection lane and preserves that limitation in its reference and artifact semantics.

## Consequences

Leon now has a reproducible acceptance lane that exercises its real agent and tool stack rather than a response-only model harness. A pass proves that the selected local models completed this bounded multi-stage workflow and that their claimed completion matched protected, independent evidence. A failure remains useful: stable codes distinguish planning, tool, route, budget, isolation, injection, oracle, and completion gaps without retaining sensitive diagnostic content.

The benchmark is intentionally slower and nondeterministic at the model layer. It uses two fresh sessions and a host-injected failure, so it proves workspace continuity across a model change but not same-session resume or organic-defect discovery. One run does not prove statistical stability, and a single fixture does not approximate every ChatGPT Work task. Repeated runs and additional protected fixtures can extend confidence without weakening this gate.
