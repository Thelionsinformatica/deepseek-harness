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

## Deterministic decision matrices

### Recall telemetry

| Input | Rule | Decision |
|---|---|---|
| No results (`total === 0`) | No continuity evidence | `reject` |
| All results filtered (`inserted === 0`) | No usable candidate | `reject` |
| Query contains an explicit credential pattern | Leakage risk | `block` |
| Low confidence (`confidence < 0.30` or `topScore < 0.35`) | Insufficient statistical evidence | `reject` |
| Text contains a sensitive term, such as password, key, token, financial, or personal data | Human review required | `confirm` |
| High confidence and score with controlled volume | Stable enough for future automatic storage | `store` |
| Other ambiguous cases | No automatic decision | `shadow` |

### Locally extracted message candidates

| Input | Rule | Decision |
|---|---|---|
| `sensitivity === blocked` | Credential signal; candidate text is omitted | `block` |
| `sensitivity === review` | Human review is mandatory | `confirm` |
| `confidence < 0.65` or `importance < 0.50` | Evidence is too weak | `reject` |
| `confidence >= 0.90`, `importance >= 0.70`, and category is not `fact` | Recommend storage after operator approval | `store` |
| Other safe candidates | Retain for comparison and review | `shadow` |

The extracted-candidate evaluator receives metadata only, not the candidate text. A `store` result is a recommendation recorded in the local queue; by itself it is not authorization to call `ctx.memory.create()`. Final storage additionally requires explicit operator acceptance plus exact user and workspace feature flags.

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
- Every reviewed candidate records an `autoWrite` trace with status, reason, and timestamp. Successful writes also retain the resulting memory id and revision; an uncertain `writing` state is never retried automatically.

### Mandatory confirmation

- Sensitive personal, financial, and medical data; interpersonal relationships; permanent instructions; and scope migrations.
- Requires explicit user confirmation in the interface or workflow.

### Eligible reviewed storage

- Only after a positive policy recommendation, high confidence, a stable category, and explicit operator approval.
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

- Deterministic trace and extracted-candidate policy without automatic write effects: implemented.
- M2-007 operator review is implemented: the browser lists only the workspace authorized by the addressed Session, receives no internal `workspaceId` or `userId`, and records immutable accept or reject decisions with date and deployment-owned reviewer identity.
- M2-008 controlled persistence is implemented but shipped off: only an accepted, non-sensitive `store` candidate whose exact user and workspace are allowlisted can call `ctx.memory.create()`.
