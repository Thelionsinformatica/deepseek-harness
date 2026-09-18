# Agent Note: Checker task review after a native peer receipt

Status: implemented

English | [中文](2026-09-12-checker-review-after-peer-receipt.zh.md)

## Problem

The v1 import-lab completion reviewer accepts a tool result containing the current artifact digest. That allows the checker to complete its task after receiving a peer discovery even if its only verification ran before that receipt. The final mission verifier correctly rejects missing post-receipt verification, but completed task state hides the missing handoff action. A passed artifact and completed task board are not proof of collaboration.

## Decision

Optional `requirePeerReviewAfterReceipt` adds a separate v2 completion contract and defaults to false. It requires [host-assigned mission composition](../feature/2026-09-12-host-mission-composition.md). Only the checker session bound by the host must supply a successful `mission_verify` result with `passed: true` for the current digest, whose call follows a native peer receipt matched to the Lead journal. Display names do not choose that function. Researcher completion and disabled v1 behavior retain their existing evidence rule.

The task reviewer and final mission verifier share the same extracted peer-proof predicate. Final success criteria remain unchanged: current artifact approval, exactly two members, at least two completed native tasks, peer receipt and post-receipt worker verification. A refused checker completion reports `MISSION_CHECKER_PEER_REVIEW_REQUIRED` without running tools, changing task revisions or completing another participant's work. The diagnostic explicitly asks for a current verification after peer receipt; it does not alter the model prompt.

## Alternatives considered

**Accept completed tasks as sufficient proof.** That removes the independent collaboration condition and incorrectly promotes an unsupported result.

**Automatically verify or complete the task.** This would fabricate agent behavior or bypass native task ownership rather than repairing admission to completion.

**Apply the rule to every existing configuration.** That would silently change the frozen baseline. The experimental flag permits comparison without reclassifying previous attempts.

## Consequences

The reviewer rejects pre-receipt, stale and failed verification even if the artifact currently passes. Only the bound checker receives the stronger contract. Budgets, reserve allocation, deadlines, prompts, normal profiles and historical attempts are untouched. This is a narrow execution-contract correction, not a claim that a model will follow the diagnostic or that the collective will outperform solo execution.

## Verification

Focused tests use native sessions, tools, tasks, roster, peer delivery and JSONL persistence with a scripted adapter. They demonstrate rejection without task mutation, acceptance after a current post-receipt proof, unchanged final success criteria, stale and failed proof rejection, swapped display names, researcher compatibility and v1 behavior. They also reject the opt-in configuration without host composition. No external model inference or GPU performance is established by these tests.
