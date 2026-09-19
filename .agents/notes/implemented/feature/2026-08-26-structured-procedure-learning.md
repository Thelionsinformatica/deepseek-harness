# Agent Note: Structured learning of verified procedures

Status: implemented

English | [中文](2026-08-26-structured-procedure-learning.zh.md)

## Problem

A text memory labeled as a procedure cannot prove that its steps succeeded, distinguish the successful trajectory from failed attempts, express environment preconditions, expire safely, or require independent verification before reuse. Treating such text as executable guidance would let a model promote its own unverified claim into durable behavior.

## Decision

`ProcedureLearningService` owns a separate local `procedure_learning` domain. The tool Consumer derives one or more successful observations from unique durable `tool/call` + `tool/result` pairs plus a distinct successful verifier from the same session. Call and result correlation must agree on call id, turn, and step; repeated ids or results are rejected as ambiguous. The service derives executable steps from those observations, stores result digests instead of result content, and rejects failed trajectories, duplicate call identities, mixed-session evidence, invalid validity windows, and credential-like retained fields before persistence. The workspace registry supplies the canonical path retained as the `cwd` precondition.

Every proposal starts as `candidate` and is invisible to reuse. `procedure_inspect` exposes its exact steps, verifier, preconditions, status, and validity inside the same workspace so the human can inspect it first. A deployment-owned reviewer accepts or rejects one exact revision through the storage domain's atomic mutation only when the latest direct human message in the active root turn carries the exact standalone `/procedure-review <id> <revision> <accept|reject>` command. Revocation has an equivalent exact command; generic human text, model initiative, and subagent turns are rejected. Only `validated` records from the exact workspace are reusable, and only while every exact precondition matches, revalidation is not due, and the validity window has not expired. A blocked record carries its verifier for an ordinary permission-checked revalidation. A verifier failure commits a `stale` revision; a later verifier success can reactivate it only with a fresh validity window. Exact revisions also protect revalidation and revocation from concurrent replacement.

The service remains an opt-in Host capability. When it is composed with the workspace and agent registries, the root plugin registers a stable policy prompt and six explicit model tools for proposal, inspection, review, search, revalidation, and revocation. The Consumer reads authoritative outcomes from the immutable session log and returns exact reviewed steps without granting stored data instruction or execution authority. It does not add an automatic observer or browser Remote.

## Verification

`procedure-learning.acceptance.spec.ts` rejects failed and credential-like proposals without a durable row; proves that a candidate is not reusable before review; serializes conflicting reviews by exact revision; reopens the same medium in a new service instance; retrieves the reviewed steps only for the matching workspace and preconditions; withholds a due procedure while returning its verifier; marks a failed revalidation stale; reactivates it after a successful verifier with fresh validity; and withholds it at expiry.

`procedure-tools.acceptance.spec.ts` drives the real AgentLoop and tool registry. Its test `learns reviewed successful tool evidence and reuses exact steps after a model switch` proves successful execution and verifier call/results, proposal, candidate inspection, rejection of a generic human turn as review authority, direct exact-command human acceptance, persistence with digests, a new session on another model in the same workspace, exact step recovery, and successful execution plus verification of the recovered arguments. A second test proves that a repeated call id is rejected as ambiguous rather than learned.

## Alternatives considered

- **Store a natural-language procedure in ordinary memory** — rejected because prose has no structured preconditions, verifier identity, evidence digest, lifecycle, or atomic promotion state.
- **Promote any successful tool call automatically** — rejected because tool success does not prove the user's objective or an independent postcondition, and the model must not approve its own durable behavior.
- **Persist full tool results or conversation history as evidence** — rejected because it expands sensitive-data retention while digests and call identities are sufficient for local correlation.
- **Treat any direct human message as review authority** — rejected because the model could otherwise approve its own candidate during an unrelated human turn. Exact id, revision, and action must be authorized in the direct message.
- **Add a browser review UI with the model tools** — deferred; the exact-command path is auditable now, while a UI can later issue the same authority operation without weakening the state machine.

## Consequences

Leon has a provider- and model-independent durable basis and model-facing Consumer for reviewed procedural memory, including deterministic blocking and revalidation. It can nominate exact successful live tool evidence explicitly and recover reviewed steps after a session and model switch. It does not nominate trajectories or execute a recalled procedure automatically. When the optional service is composed, the stable prompt and six schemas have a fixed model-token cost; individual operations append after that cacheable prefix.
