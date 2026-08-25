# Memory V2 — Security and compliance policy

English | [中文](memory-v2-security-policy.zh.md)

## Principles

1. Do not send personal data automatically to external models without explicit consent.
2. Enforce `workspaceId` isolation before every search, decision, or write.
3. Do not expose sensitive data or internal `workspaceId` values in LLM responses.
4. Deterministic policy always overrides probabilistic decisions.

## Policy modules

### Absolute block

- Passwords, tokens, keys, cookies, environment secrets, and snippets identified as credentials.
- Never persist them through `memory_remember` or `memory_update`.
- Run `looksSensitive` or the redactor before writes and during recall.

## Deterministic decision matrix (implemented for shadow traces)

| Input | Rule | Decision |
|---|---|---|
| No results (`total === 0`) | No continuity evidence | `reject` |
| All results filtered (`inserted === 0`) | No usable candidate | `reject` |
| Query contains an explicit credential pattern | Leakage risk | `block` |
| Low confidence (`confidence < 0.30` or `topScore < 0.35`) | Insufficient statistical evidence | `reject` |
| Text contains a sensitive term, such as password, key, token, financial, or personal data | Human review required | `confirm` |
| High confidence and score with controlled volume | Stable enough for future automatic storage | `store` |
| Other ambiguous cases | No automatic decision | `shadow` |

## Traces recorded in the project

- `memory/operation` records the provider, operation, result count or revision, duration, and success after the durable operation completes.
- `memory/blocked` records only a normalized reason, source, scope identity, optional memory id, and safe diagnostic detail.
- Every `memory/candidate` event includes:
  - `policyVersion` (`1`)
  - `policyDecision` (`block|reject|shadow|confirm|store`)
  - `policyReason`
- Events and durable candidate rows store `queryLength`, never the transient query text.
- No memory event stores recalled or rejected content.
- The durable `memory_candidate.candidates` domain includes the same fields for review and replay.
- A safe `message_candidate` may retain its proposed text only in the local review row. Credential-like candidate text is omitted before persistence, and no candidate text is emitted through runtime events.

### Mandatory confirmation

- Sensitive personal, financial, and medical data; interpersonal relationships; permanent instructions; and scope migrations.
- Requires explicit user confirmation in the interface or workflow.

### Permitted automatic storage

- Only after a positive policy decision with high confidence and a stable category.
- Examples include a confirmed technical decision, non-sensitive configuration, or repeatable work procedure.

### Decision record

- Every candidate produces:
  - `candidate_id`
  - policy version
  - reason (`policy_reason`)
  - data source
  - decision (`shadowed`, `confirmed`, `stored`, or `rejected`)
  - `confidence`, `importance`, and `sensitivity`
  - internal `workspaceId` and `userId`
  - timestamp

## Cloud privacy and authorization

- A policy that escalates to Gemini must require per-action consent with scope and cost.
- Recall or decision memory must not be sent to an external provider by default.

## Policy versioning

- Every rule change receives a `policyVersion`, such as `v1` or `v2`.
- Each decision persists the applied version, enabling replay and rollback.

## Security failures (severity status)

- `cross_workspace_hit`: critical failure.
- `unmasked_sensitive_recall`: critical failure.
- `policy_bypass`: critical failure.
- `cloud_upload_without_consent`: critical failure.
- `revision_conflict`: integrity failure handled through controlled refusal.

## Current status

- Deterministic trace policy without automatic write effects: implemented.
- Recommended next stage in M2-006/07: connect `confirm` and `store` to a review queue, and persist only after validation.
