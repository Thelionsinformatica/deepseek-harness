# Agent Note: Client domain graph restored for the task-validation node

Status: implemented

English | [中文](2026-09-25-client-domain-graph-task-validation.zh.md)

## Problem

The client domain-graph gate was red: `ui-conversation/src/client/chat/TaskValidationView.tsx` imported `../conversation-nodes/task-validation.ts`, a sibling-domain edge whose budget is zero. The edge arrived with the collective feature commit `3592c8af11`, and it stayed unnoticed because this gate was outside the routine checks until a full sweep of every executable gate was run.

## Decision

The shared parts of the task-validation chat node — `ValidationPhase`, `TaskValidationState` and the pure helper `taskValidationPhase` — now live in `contract/chat-nodes.ts`, beside the other chat-node payloads and pure helpers, and both the view and the node module import them from there. `TaskValidationState` is declared `readonly` to match its new siblings. The gate script and its legacy budgets are untouched: the forbidden edge is gone rather than budgeted.

## Alternatives considered

**Moving the view into `conversation-nodes/`** breaks the package convention that every renderer registered under `conversation.chat.node` lives in `chat/`, and it would have required editing the client slot catalog outside the scope of the repair.

**Adding a legacy budget entry** cannot be the answer: the budgets are a ratchet where a new edge fails the gate, and the gate's own contract says a legacy edge is reduced when refactored, never enlarged. Budgeting this edge would have preserved the violation.

**Copying the helper into both domains** duplicates a payload-and-helper pair that the contract layer already owns, and leaves two copies free to drift.

## Consequences

The client domain graph is green again: no new edges, 27 locked legacy occurrences. The task-validation payload now follows the same arrangement as its siblings, so a future reader finds one pattern instead of an exception. The change is a relocation: the helper body is byte-identical, `readonly` is erased at emit, and no site assigns those fields. The gate still proves only what it checks — it fails when a forbidden edge appears, and cannot show that none exists elsewhere.

## Testing

`verify-client-domain-graph` exits 0, and `vitest run packages/client/ui-conversation` passes 32 files and 512 tests, including the task-validation spec, which exercises replay against live. Type equivalence is inferred from module resolution plus the absence of assignment sites; no typecheck ran in that round. Verification stayed local: CI owns the platform matrix.

## Related

[GUI web client architecture](../architecture/2026-07-19-gui-web-client-architecture.md) states the layering rule that this repair restores.
