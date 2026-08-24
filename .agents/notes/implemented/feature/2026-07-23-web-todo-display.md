# Agent Note: Web todo display — snapshot side-effect channel + two render surfaces

Status: implemented

English | [中文](2026-07-23-web-todo-display.zh.md)

## Problem

`todo_write` appends `todo/write` whole-list snapshots to the session log; the TUI renders a persistent plan panel (the automation-only ACP bridge deliberately omits todo presentation). The web client dropped the event entirely: the host mux stream already forwards every session event, but `todo/write` is not a surface type (it never folds into `ConversationSnapshot.nodes`), and no side-effect branch accumulated it — the browser had no consumption point and no display surface.

## Decision

Consume `todo/write` as a Session side effect, not a surface node, and render it on two surfaces matching the split the TUI already draws.

### Host projection, converging with replay

`dsh-tool-todo` registers the `todos` session projection: whole-list `todo/write` events are last-write-wins, automatic messages retain the value, and the next direct-human `user/message` clears it ([task-scoped plan lifetime](2026-07-28-todo-plan-clears-on-next-turn.md)). The Host supplies this authoritative value on the tail-page projection baseline and through `session/projection` push frames. The client projection store seeds and updates the same key, so rollback, reconnect, and cold replay converge without rebuilding domain rules in the conversation package. This follows the event's own contract ("log-only UI state; never derived history"): surfacing each write as a conversation node would render superseded lists as if they were still standing.

### TodoPanel: the durable list as a persistent strip

The panel mounts through the `conversation.input.dock` slot (a plain registrant plugin, `todoDockEntry`, using `ctx.slots.inject` with no `ConversationController` edge, `order: 0` above the queue rows), hidden while empty and collapsible. Its header combines one explicit activity truth from the owning session's running bit and list state — working, stopped with incomplete work, or completed — with `·`-joined per-status counts. Status glyphs are the figma todo set (green check ring / blue fading ring / dashed pending ring) on a tip-surface card (`--dsw-specific-tip`, 14px radius, `width: calc(100% - 88px)` / `max-width: 776px` centered; InputBar top pad 6px is the gap to the composer card). It reads the host-computed `todos` projection via the standard-kit `useProjection` hook and the session's running state through `useSession`. The inner component stays props-complete and framework-free.

### TodoRow: the per-call row through the keyed toolview slot

The dedicated `todo_write` chat row is a plain registrant plugin (`todoToolview`, mounted from `apply`) that registers into the keyed `tool.call.toolview` slot through `ctx.slots.inject`, the same declaration-lifetime posture as the bash sample but a product registration. The summary derives from call args (`N/M done · first active item`, with a `+<n>` count of the other active ones in `ToolRow`'s non-shrinking `summarySuffix` slot); unparseable args fall back to the generic row summary; clicking opens the details column with the raw args. No `ToolEventView` is added for todo — presentation is client-owned, and the durable list renders from the session event, not the tool card.

## Alternatives considered

- **Fold todo writes into `nodes` as surface entries** — replayed windows would render every superseded list; the event is deliberately not a surface type.
- **Hardcoding the panel inside `ConversationRoot`** — the original landing spot before the input-dock slot existed; the dock is the architecture's home for always-on strips above the composer, and a hardcode bypasses the slot registry's disposal and ordering.
- **Details column for the panel** — the details slot is single-occupant and selection-driven, a different lifetime than an always-on strip.
- **Host-computed view (a todo `ToolEventView`)** — presentation belongs to the client; the wire already carries the whole snapshot in the event payload.

## Consequences

Replay correctness is owned by the domain projection, and `packages/client/ui-conversation/tests/todo-panel.client.spec.tsx` pins row summary, working/stopped/completed state, panel content, and collapse round-trip. The automation-only ACP bridge deliberately omits todo presentation; the Web surfaces render the same durable domain value without adding a conversation node. A reopened session restores the plan when it still belongs to the current human task, automatic Goal Rounds keep it visible, and a later direct-human message clears it before the next plan is written.
