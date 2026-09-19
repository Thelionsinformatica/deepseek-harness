# @deepseek-ai/dsh-tool-todo

English | [中文](README.zh.md)

The model-facing `todo_write` tool: the agent's whole task list, replaced wholesale on each call.

## What it does

Registers one tool, `todo_write(todos: [{ content, status }])`, on `ctx.tools`. The model sends the ENTIRE list every call — there are no partial updates or per-item edits. Each call appends a `todo/write` event (the full list snapshot) to the calling agent's session log via `agent.session.append('todo/write', { todos })`; the current list is the most recent such event (last-write-wins on replay).

`status` is one of `pending`, `in_progress`, or `completed`.

## Single owner

The list belongs to the ONE agent session that called the tool. There is no subagent/shared/swarm scope: a non-agent caller (no `exec.agent`) has nowhere to write the list and is rejected. This is a deliberate scope limit — see the Agent Note.

## Configuration

`allowParallelInProgress` is required: every composition must choose whether several todos may be `in_progress` at once. It is a deployment choice, not a fixed rule: whether concurrent active tasks are legitimate depends on runtime concurrency the tool cannot observe. Use `true` for agents that may fan out work and `false` to enforce the single-active discipline.

The flag moves the model-facing instruction and the accepted input together — `true` asks the model to mark every actively worked task and accepts any number, `false` asks for exactly one and rejects a call marking more with `Error: invalid todos: at most one task may be in_progress (got <n>)`. The durable-log invariant does NOT follow it: a log written while parallel work was allowed must still replay after a deployment tightens the policy, so the invariant stays silent on the active count.

`preserveExistingItems` is also required. When `true`, later writes in the same direct-human task must retain every existing item with identical content and relative order, and a completed item cannot move backward; newly discovered items may still be inserted. This rule starts the model-facing description so description compaction retains the safety requirement. A later direct-human message starts a fresh plan only when no unfinished durable goal still owns the checklist; resume messages keep an active, paused, or blocked goal's plan until that goal becomes terminal. Leon enables this policy to prevent continuation rounds or a human resume after restart from replacing or reopening the standing checklist; generic compositions may choose `false` to retain unrestricted whole-list replacement.

## Validation

Beyond the schema's type/required/enum checks, `execute` rejects an empty or duplicate `content`, and any item key beyond `content`/`status` — an extended item shape (ids, nesting) fails loud instead of silently flattening, keeping the logged snapshot equal to what the model believes it wrote. How many tasks may be `in_progress` at once and whether an existing task plan is additive are deployment choices (§ Configuration). A rejected removal, rename, reorder, or completed-item regression appends no `todo/write` event and returns the complete accepted list in canonical order so the model can update statuses, retain or insert legitimate discovered work, and retry without reconstructing compacted history.

## Rendering

The canonical result is `{ todos, counts: { pending, inProgress, completed } }`; its Native renderer returns the compact update acknowledgement. The tool also writes the full `todo/write` session event. UIs subscribe to the event stream and render that durable list themselves: the [web client](../../client/ui-conversation) shows a plan strip plus a dedicated tool row from the standing projection ([display](../../../.agents/notes/implemented/feature/2026-07-23-web-todo-display.md), [lifetime](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)). Automatic continuation and direct-human resume messages retain the list while an unfinished durable goal owns it.

## Session projection

When the composition mounts `ctx.sessionProjections` ([`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)), this package registers the `todos` projection unit under an injected child. Its host-only state stores the latest whole list plus the id of any unfinished goal that owns it; the wire view exposes only the list. `todo/write` replaces the list, `goal/change` acquires or releases ownership, and a direct-human `user/message` clears the list only when no unfinished goal owns it. Terminal goal state releases ownership but keeps the final checklist visible until the next human task; creating a different goal clears that old checklist immediately. The projection uses `stateVersion` = 4. The key merges into `SessionProjectionMap` here (via the Service Definition package's `/types` outlet); the framework drives the unit and carriers serve the value on the history tail page and the `session/projection` push frame. Compositions without the registry are unaffected. Lifetime rationale: [todo plan clears on the next human task](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md).

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`todo_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the entire replacement list in its arguments. Success returns exactly `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.` Stable failures are ``Error: invalid todo: `content` must be a non-empty string``, `Error: invalid todos: duplicate content "<content>"`, `Error: todo_write requires an owning agent session`, and — only under their respective deployment policies — `Error: invalid todos: at most one task may be in_progress (got <n>)`, `Error: invalid todos: preserved plan must retain existing item "<content>"; retry with this canonical list intact and in order; update statuses and retain any legitimate new items: <json>`, and the corresponding canonical-list suffix after `Error: invalid todos: completed item cannot move backward "<content>"`. The full `todo/write` session event is UI and replay state, not a second model message.

#### Token effect

Token growth scales with every full list the model submits, and those call arguments remain until compaction. Success is compact; a preservation rejection repeats the complete accepted list and therefore scales with that list.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Single-owner scope only** — the list belongs to the one calling agent session; subagent/shared/swarm scopes are a deliberate cut (see § Single owner), and a non-agent caller is rejected.
- **The item shape is deliberately minimal** — `content` plus three-state `status`; whole-list replacement needs no stable id, priority, or active-form fields.
- **Whole-list replacement is the only operation** — no partial updates, no read-back tool; the model must resend the entire list each call.
