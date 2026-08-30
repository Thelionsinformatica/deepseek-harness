# Agent Note: Leon requires evidence before global completion claims

Status: implemented

English | [中文](2026-08-29-leon-completion-evidence-guard.zh.md)

## Problem

Leon could end an ordinary turn with a global claim such as “everything works” even when the same turn still contained pending todos, failed tools, nonzero command exits, or claimed output files that did not exist. The goal completion auditor protected only the explicit goal-completion path, so final assistant text could bypass it. Prompt instructions alone did not turn the session event log into an enforced completion condition.

## Decision

A Leon-specific completion-evidence plugin listens at `agent/turn-stopping` and inspects only affirmative, unscoped strong global completion claims. Sentence-local classification does not block negated, conditional, quoted, uncertain, partial, or explicitly blocked reports, while a disclaimer cannot hide a later positive claim. For a candidate claim, the plugin reconstructs the current turn from durable session events: the latest todo state, paired tool calls and results, command exit codes, and absolute artifact paths asserted in the final response. A later successful result resolves an earlier failure only for the same tool name and exact durable argument payload; missing or contradictory evidence remains an open gap.

When a claim has open gaps, the plugin prevents the turn from stopping and injects a durable plugin-sourced correction through the ordinary inbox/user-message path. The complete correction is UTF-8 byte bounded, and filesystem checks are count bounded; overflow is reported as an evidence gap instead of silently trusting omitted details. The correction requires Leon either to complete and verify the work or to report the result as partial or blocked. If Leon repeats the unsupported global claim after the configured correction allowance, the plugin fails closed with the stable `COMPLETION_EVIDENCE_UNSATISFIED` code.

In Leon Automatic, the durable correction selects the configured local expert route with high reasoning effort for the retry. It does not authorize an external API route, change provider-residency policy, or treat unsupported completion as provider unavailability. Manual model selection remains manual. The existing goal completion auditor remains a separate second barrier for an explicit goal-completion request.

## Verification

Focused completion-evidence tests pin adversarial PT/EN classification, pending and in-progress todos, unresolved exact-operation failures, nonzero command exits, missing asserted artifacts, the artifact-check count, and complete multibyte UTF-8 recovery bounds. They also pin that an identical successful retry resolves the corresponding failure, a different operation does not hide it, an honest partial or blocked response may stop, and a repeated unsupported claim returns `COMPLETION_EVIDENCE_UNSATISFIED`. A keyless Loader snapshot boots the real composition and records both the durable model-visible correction and the honest replacement response.

Adaptive-routing tests pin that the correction selects only the configured local expert route at high effort in Leon Automatic. They also pin that manual selection is unchanged and that the correction does not activate an external provider. Existing goal tests continue to exercise the independent completion auditor.

## Alternatives considered

**Rely only on the system prompt.** Rejected because instructions can influence wording but cannot compare a final claim with authoritative session events or prevent the turn from stopping.

**Use only the goal completion auditor.** Rejected because ordinary final responses do not have to call the goal-completion tool, which is the bypass this decision closes.

**Retain and inspect the entire model stream.** Rejected because reasoning and partial stream tokens are not the authoritative user-visible result, increase retention cost, and still require reconciliation with durable tool evidence.

**Add the behavior to `failure-recovery-policy`.** Rejected because repeated tool execution failure and unsupported completion are different policies. The Leon-specific plugin owns claim classification and evidence reconciliation without changing general recovery behavior for other compositions.

## Consequences

A contradicted strong global completion claim can no longer remain the terminal state of Leon's turn. Because validation runs after `assistant/message` is committed, the first streamed claim may already be visible; the same turn then receives a concrete corrective continuation, and one local high-effort retry can repair the evidence before the guard fails closed. Honest partial and blocked reports remain available, manual model control and external-data residency remain unchanged, and explicit goal completion still receives the independent auditor check.

The plugin deliberately recognizes a narrow class of strong completion language and absolute artifact claims. It does not prove the semantic quality of successful work, replace domain-specific tests, or infer whether an unmentioned artifact should exist; those remain the responsibility of task-specific verification and the goal auditor.
