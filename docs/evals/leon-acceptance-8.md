# LEON-ACCEPTANCE-8

English | [中文](leon-acceptance-8.zh.md)

## Purpose

LEON-ACCEPTANCE-8 is a local-only, end-to-end benchmark for one bounded autonomous engineering workflow. Unlike the single-answer cases in LEON-ACCEPTANCE-7, it drives the real headless Leon AgentLoop, ToolRuntime, filesystem tools, todo tool, and shell tool through planning, multi-file implementation, test execution, deterministic fault injection, diagnosis, repair, and host-verified completion.

The benchmark does not trust Leon's final prose. Its decision comes from durable `tool/call` plus `tool/result` events, protected-file hashes, three host-owned hidden-oracle runs, exact local route evidence, and a final source digest bound to the passing oracle.

## Prerequisites

- Build the repository so `apps/cli/lib/bin.js` and the workspace package libraries exist.
- Run Ollama on the literal loopback endpoint `http://127.0.0.1:11434`.
- Install the exact model ids `qwen3.5:9b` and `ornith-1.5:9b` in Ollama.
- Use Node.js 22.19 or later. The fixture uses only Node's built-in test runner and installs no dependencies.

Confirm the model ids before a run:

```sh
ollama list
```

## Run the benchmark

```sh
pnpm exec tsx scripts/run-leon-acceptance-8.ts
```

The default sanitized artifact is `.artifacts/leon-acceptance-8/latest.json`. Use `--output <path>` to select another destination. `--implementation-model` and `--recovery-model` may select other already-installed local model ids, and `--ollama-url` may select only an unauthenticated HTTP endpoint on literal `127.0.0.1` or `[::1]`.

## Execution phases

1. The host creates a dependency-free project fixture in a temporary directory. `TASK.md`, `package.json`, and the visible test are immutable evidence inputs.
2. A fresh headless Leon runtime uses the implementation model. Its first tool must be `todo_write` with at least five steps; it must edit at least two required source files and run exactly `node --test` successfully.
3. A hidden test outside Leon's workspace verifies rounding, discount clamping, exact report formatting, and input non-mutation. The host binds the result to the exact source hashes.
4. The host replaces only `src/currency.mjs` with a known rounding regression. The hidden test must now fail, proving that the oracle detects the injected defect.
5. A second fresh headless Leon runtime uses the recovery model over the current workspace. It must first run `node --test` and observe the failure, then inspect, diagnose, repair, and run the same exact command successfully.
6. The host runs the hidden oracle again. Approval requires a passing result bound to the final source hashes, unchanged protected files, and no unexpected special filesystem entries.

## Local-only and isolation safeguards

- The child receives an environment allowlist rather than the parent environment. Supported Anthropic, DeepSeek, Gemini, Google, NVIDIA, OmniRoute, and OpenAI credential variables are structurally absent, as are proxy variables.
- The launch directory and both DSH homes are temporary and contain no inherited `.env` or settings file.
- The model catalog contains exactly one Ollama route for each stage. Settings, credentials, web, jobs, skills, code runtime, goals, workflows, Ralph, OpenCode, and in-process subagents are disabled.
- The session uses `workspace-write` with approval disabled. Mutations outside the fixture fail in the filesystem sandbox; any filesystem tool argument that resolves outside the workspace also fails the evidence gate.
- The only accepted shell command is exactly `node --test`. Any other shell command or any unapproved tool name fails the run.
- The hidden oracle is written outside the workspace, and the model receives neither its path nor its content.

## Decision and budgets

A run passes only when every phase is proved. Each stage is bounded to one turn, 30 model steps, 80 tool calls, 250,000 input tokens, 50,000 output tokens, and 15 minutes. The wall-clock limit terminates the child; the remaining budgets are evaluated from the durable session log and fail the result when exceeded.

The benchmark also rejects a non-local or unexpected model route, missing or forged oracle-to-source binding, a host injection whose hash differs from the canonical regression, protected-file changes, special filesystem entries, external path references, and a completion without the recovery model observing a failed test followed by a later passing test and the final host oracle.

## Artifact and confidentiality

The runner atomically writes a sanitized JSON artifact after deleting the temporary fixture, both DSH homes, and raw session logs. It retains model ids and Ollama digests, numeric timing and token evidence, relative source names and SHA-256 hashes, tool/test sequence numbers, phase booleans, stable failure codes, and hashed stdout, stderr, and completion text.

It does not retain prompts, source contents, model responses, tool arguments or results, absolute temporary paths, credentials, hidden-oracle text, or stack traces. The artifact proves the benchmark decision; it is not a transcript or a provider invoice.

## Interpretation limits

The failure is deliberately injected by the host between two fresh headless sessions. This proves fault detection, workspace-state continuity across a model change, real tool execution, and verified repair. It does not prove that one uninterrupted Leon session discovered an organic defect, nor does it prove same-session runtime resume.

One small order-summary fixture is a bounded engineering benchmark, not proof of arbitrary multi-hour or multi-month autonomy. A single pass also does not establish statistical stability. Repeat the command and compare artifacts when model-output variance matters; model weights, quantization, Ollama version, hardware, and thermal state can change latency and behavior.

The hidden oracle is deterministic but intentionally scoped to the fixture's product contract. Passing it does not prove security of arbitrary generated code. The benchmark permits local filesystem reads only when their tool arguments stay inside the fixture, but it is not an operating-system VM or malware sandbox.

The implementation decision and rejected alternatives are recorded in the [LEON-ACCEPTANCE-8 Agent Note](../../.agents/notes/implemented/testing/2026-08-26-leon-acceptance-8.md).
