# Agent Note: Todo plan strip clears on the next direct-human task

Status: implemented

English | [中文](2026-07-28-todo-plan-clears-on-next-turn.zh.md)

## Problem

`todo_write` stores whole-list snapshots on the session log, and interactive hosts render the latest list as a plan strip. A completed or abandoned checklist must not leak into the next task the user requests. However, a long-running goal deliberately spans several automatic turns; clearing its checklist at every `turn/start` makes the same task appear to vanish between continuation rounds and removes the evidence needed to reject premature completion.

## Decision

The standing plan is the latest `todo/write` that is not followed by a later direct-human `user/message` (`source.kind === 'user'`). `turn/start`, `turn/end`, and goal- or plugin-sourced messages retain the list. A new human request clears the previous task before the model writes its replacement, while every automatic Goal Round sees and updates one continuous plan for the same objective.

### Host projection (web)

`dsh-tool-todo`'s `todos` projection unit folds the rule: `apply` takes the whole list from each `todo/write` and returns `null` only on a later direct-human `user/message` (`stateVersion` 3). Carriers (`dsh-host-apiproxy`) serve that value on the history tail `projections` block and push `session/projection` frames; the web dock reads it through `useProjection('todos')`.

### TUI live path

The former TUI used the earlier turn-boundary rule and has since been removed ([remove TUI package](../simplification/2026-08-04-remove-tui-package.md)). The authoritative remaining product path is the host projection consumed by the Web dock.

## Alternatives considered

- **Clear on every `turn/start`** — rejected because an automatic Goal Round is a new turn for the same task; the plan would disappear exactly while Leon continues working.
- **Clear on `turn/end`** — hides the checklist while the user is still reading the just-finished answer; the strip's job at that moment is the completed plan, not an empty dock.
- **Clear only when every item is `completed`** — leaves abandoned or partial plans across turns; the strip would still show another task's work.
- **Append an empty `todo/write` on human input** — mutates the log for a UI lifetime rule and invents a write the model never authored.

## Consequences

Reopening a session restores one plan across all automatic rounds of its task. The next direct-human request retires that plan before new work begins. Event sourcing and last-write-wins replacement remain owned by [web todo display](2026-07-23-web-todo-display.md) and [`todo_write` tool](2026-06-29-todo-write-tool.md); this note owns the direct-human boundary. Projection tests pin automatic-turn retention, plugin-message retention, direct-human clearance, and the version bump that invalidates cached state folded under the old rule.
