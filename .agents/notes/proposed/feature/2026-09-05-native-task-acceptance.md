# Agent Note: Native exact-task acceptance

Status: proposed

English | [中文](2026-09-05-native-task-acceptance.zh.md)

## Problem

A successful read and completed turn can still deliver a truncated value. Global completion-claim detection intentionally does not inspect ordinary answers.

## Proposal

The opt-in implementation in [completion-claim-policy](../../../../packages/guard/completion-claim-policy/README.md#exact-task-acceptance) binds trusted exact-output criteria to the user message and checks the final answer before turn stopping. It stores criteria and decisions in session events and uses bounded native steering rather than an external controller. The source implementation and keyless Loader scenario exist; production activation remains deferred.

## Alternatives considered

Inferring correctness from successful tools would reproduce the defect. Letting the executor choose its own expected answer would not provide independent validation. A mandatory second model for every response would incur cost and still not guarantee truth. Exact criteria cover deterministic tasks while leaving open-ended answers explicitly unvalidated.

## Acceptance criteria

Verify exact answers, missing and failed reads, wrong file targets, exhausted retries, task isolation, ambiguous queued messages, replay, HMR and duplicate stop callbacks. The assembled Loader transcript must show same-turn correction and failure, with stable model-visible text. Native local inference, crash recovery, both SDK event projections and UI integration remain required before production promotion.

## Risks

Functional arithmetic acceptance is an opt-in alternative to an exact hash. It uses a closed binary-expression grammar instead of porting the Python AST pilot or launching model-produced code. This narrows useful syntax deliberately to eliminate executable validators and external runtimes. Trusted numeric examples may be shown to the model in bounded, logged same-turn recovery; no canonical expression is supplied. Finite example passing is not general correctness, and float equality is exact. API admission and durable reconstruction reject mixed criteria and require read-only execution. Existing validation event names and reasons are unchanged; production UI, general project validators and rollout remain deferred.

The read-only candidate adds an explicit trusted `readOnly` criterion carried by RPC into durable task metadata. The executor's existing monotonic guard denies every tool except read/glob/grep during that open turn, including recovery and additional user messages; the next ordinary turn is unchanged. This deliberately blocks shells and delegation instead of trusting their descriptions. It does not cover direct plugin I/O or background work and is not an OS sandbox. Unit and Loader tests must prove denial before the tool body. Production activation and a UI permission selector remain deferred.

The isolated local pilot preserved under `D:/Leon/audits/baseline-pilot-20260905-222307` passed 8/15 strict cases. A separate four-case recovery probe corrected two answers and exhausted its bounded retry on two others; this is not a statistical reliability estimate. The 2026-09-06 recovery-text candidate explicitly checks requested formatting and complete output units, while preserving user-requested JSON and the prohibition on file edits. It does not expose the expected answer or change routing, budgets or outbound consent. Real-model comparison of this candidate remains pending; deterministic tests alone cannot establish an improvement.

The client runtime forwards explicit criteria per root-session prompt, without retaining a session default or mixing the expected answer into model content. Both child modes reject criteria before transport, preserving the error for the composer. Runtime tests cover request isolation, child rejection and host-error propagation; the composer draft transaction and criterion editor remain pending.

The UI projection distinguishes provisional pass from a completed validated turn and suppresses validation for ordinary turns. Live/replay and cancellation-state tests cover the projection; browser visual verification and a chat criterion editor remain pending. The host now admits explicit criteria through idle, empty-inbox queue requests to `session.prompt`, resolving the isolated preset service. A real local llama.cpp run through preset `leon` passed exact-answer and required-read checks on its first attempt. That run does not establish live recovery after a model error. Host and client builds and 88 focused tests pass.

Streaming may display an answer before acceptance; consumers must not treat the first text or turn/end alone as proof. Expected-answer hashes are not secret storage. A read result establishes execution, not file freshness. RPC criteria use the host's existing authorization and bounded input validation; they do not grant new authority. Recovery provenance can activate an existing model-recovery route, but cannot grant outbound consent.
