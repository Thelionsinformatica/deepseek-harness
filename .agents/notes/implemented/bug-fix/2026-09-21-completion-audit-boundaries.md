# Agent Note: Enforced auditor capabilities and reviewed artifact freshness

Status: implemented

English | [中文](2026-09-21-completion-audit-boundaries.zh.md)

## Problem

A mutation denylist left arbitrary shell and child-owned tools callable by the completion reviewer. Installing protection after subagent startup was too late: the first request could already be running. Same-turn reuse checked parent events but could approve files changed outside those events.

## Decision

The one-shot subagent request accepts a host-only `setup(childCtx)` callback. Providers explicitly advertise support; unsupported providers fail before startup. In-process spawn and fork await setup after composition and structured output installation, before publication and inference. Failure rolls back the child. This callback is neither model-selectable nor persisted or replayed for continuable children.

Completion review installs a monotonic execution guard in that unpublished child scope. The exact host-created agent may call the evidence reader, artifact reader, structured output and the deployment's explicit `completionAuditorTools` allowlist. Generic execution is absent by default. Inherited filters alone do not cover child-owned tools; the execution guard covers those and nested dispatch too. Host plugins and approved verifier implementations remain trusted code.

`completion_artifact_read` delivers bounded complete UTF-8 files through `ctx.fs`, confined to the assigned workspace. Only an unchanged successful final tool result enters the manifest. New receipts carry path/provider identity, SHA-256, byte count and explicit file coverage, not file contents. Rechecks after review and before reuse reject changes, missing files or redirected targets. Parent history must remain unchanged during asynchronous verification. Legacy receipts stay readable but are not reusable.

Artifact-required review is opt-in for non-file-goal compatibility. Empty coverage is explicitly `no-files-reviewed`; it must not be described as file verification. Defaults bound evidence to 64 paths and 1048576 bytes per file. Conventional credential names and all Windows stream syntax are rejected, including streams attached to ordinary filenames. Colons outside a leading drive designator are rejected on every provider; ordinary drive and UNC paths remain subject to containment. This is not universal secret detection. Reader content still follows the configured auditor model route.

This partially supersedes the shell-policy choice in [goal tools](../feature/2026-07-19-model-facing-goal-tools.md) and the external-write limitation in [paged review](2026-09-20-completion-incomplete-evidence-gate.md). Both notes remain active because authority, ordering and evidence-delivery decisions still apply. No historical records are archived or removed.

## Alternatives considered

**Prompt prohibition or an inherited denylist:** neither closes unknown capabilities or child-owned registrations. The host enforces a closed set at execution.

**Install on the start event:** publication and first inference can precede that event. The setup hook supplies the earlier lifecycle boundary without changing the agent loop.

**Hash paths mentioned in text:** a mention proves neither complete delivery nor actual bytes. The dedicated reader records the final delivered result through the existing filesystem provider.

**Filter only the base filename of a stream:** a Windows stream can hold independent bytes under an ordinary filename. Rejecting stream syntax prevents those bytes from bypassing credential-name checks; it also excludes ordinary colon-bearing names on other providers.

**Lock the entire workspace:** that requires writer admission across processes and filesystem providers. This change makes bounded freshness observations instead and does not claim atomic exclusion of external writers.

## Consequences

Auditors need narrow host-approved verifiers for executable checks; they cannot silently inherit general shells. A denied capability may legitimately prevent approval. Reading at least one file does not prove complete requirement coverage or semantic correctness. Hashes are point-in-time observations, not a global writer barrier, and cannot detect a later write after the final check.

The package includes the generated `audit-artifacts-*.js` shared chunk alongside the existing receipt chunk family. The workspace packaging constraint tracks this closure; a successful source typecheck alone does not prove that the installed package can load its invariant and tool entries.

Focused tests cover setup order, rollback, cancellation, nested/tool-owned bypass attempts, invalid provider identities, artifact bounds, altered delivery, durable validation and stale bytes. Windows Loader tests use actual alternate streams to verify refusal and preserve ordinary file reads; provider tests cover drive and UNC spellings. The keyless `goal-auditor-boundaries` ACP snapshots exercise restricted calls and refusal after an external file change through the real loop and persistence. These deterministic tests do not establish a real model's review competence, paid-provider behavior or production rollout.
