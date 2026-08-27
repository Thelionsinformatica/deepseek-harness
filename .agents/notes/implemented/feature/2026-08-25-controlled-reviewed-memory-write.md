# Agent Note: Controlled final writes for reviewed memory candidates

Status: implemented

English | [中文](2026-08-25-controlled-reviewed-memory-write.zh.md)

## Problem

The candidate panel could record a human decision but could not promote an approved candidate into provider-neutral durable memory. Writing every `store` recommendation automatically would bypass the operator, while using one global switch would allow an approval from one workspace or local owner to authorize another scope. A provider or journal failure could also create an untraceable or duplicate write.

## Decision

- Human `accept` remains mandatory. `reject` and `ignore` never write memory.
- Controlled persistence is owned by the Host review service, where the canonical candidate row, resolved workspace, configured local owner, and `ctx.memory` seam are available together.
- The shipped Web composition sets `automaticWrite: false` and empty allowlists. A write requires the master switch, the exact candidate `workspaceId` in `automaticWriteWorkspaceIds`, and the exact candidate `userId` in `automaticWriteUserIds`.
- Only a non-sensitive candidate whose deterministic decision is `store` may call `ctx.memory.create()`. Approval of `shadow` or `confirm` still records review without final storage.
- The candidate row is the decision journal. It records `skipped`, `writing`, `stored`, or `failed`, a stable reason, and a timestamp. A successful write also records the memory id and revision.
- `writing` is persisted before provider mutation. Provider failure becomes `failed` and leaves the candidate unreviewed for retry. If journal finalization is uncertain after a write attempt, the `writing` state refuses automatic retry so the service cannot create a silent duplicate.
- Repeating a successfully completed approval is idempotent and returns the original stored trace.

## Verification

Host integration coverage proves the off-by-default behavior, cumulative user and workspace authorization, rejection of non-`store` automatic persistence, successful reviewed write, durable trace fields, repeat idempotency, provider-failure recovery, and refusal to repeat an uncertain `writing` journal. Browser coverage proves distinct feedback for a decision-only approval and a locally stored memory. The focused run passed 25 tests, and the repository-wide `check:all` run passed all 48 gates with none skipped. The implementation does not change model prompts, tool results, Gemini credentials, or cross-workspace retrieval.

## Alternatives considered

**Write immediately from the extraction policy.** Rejected because `store` is a recommendation, not consent, and extraction runs before the user can inspect the candidate.

**Use one global automatic-write switch.** Rejected because it cannot express user and workspace isolation and makes rollback unnecessarily broad.

**Retry every incomplete journal state.** Rejected because a process can lose the final journal update after the memory provider already committed. Retrying an uncertain `writing` state could duplicate durable memory.

## Consequences

Leon can now convert an explicitly approved, safe, high-confidence candidate into local durable memory without coupling the feature to Ollama, Gemini, OpenAI, or another model. The feature remains disabled in the shipped composition until an operator deliberately enables one exact user and workspace. The current UI reports the outcome but does not yet edit those allowlists; configuration remains a Host-owned operational control.
