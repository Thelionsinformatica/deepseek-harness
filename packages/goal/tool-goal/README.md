# @deepseek-ai/dsh-tool-goal

English | [中文](README.zh.md)

The model-facing control tools for [`ctx.goals`](../goal/README.md): `get_goal`, `create_goal`, and `update_goal`. The [goal-tool Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-model-facing-goal-tools.md) owns the authority split and Codex-shaped UX.

## Tools

- `get_goal()` returns the current goal or `null`, including the compare-and-set id/revision, durable phase, admitted/capped goal rounds, any blocker reason, and current process-local activation.
- `create_goal(objective, max_goal_rounds?)` creates one goal from a direct top-level human turn. The model may infer long-running goal intent without an exact command phrase; non-human turns and subagents are rejected at execution.
- `update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)` supports `edit`, `pause`, `resume`, `complete`, and `blocked`. Replacements belong only to `edit`; `blocked_reason` is required only for `blocked` and is persisted with the stable code `model-reported`. Strict-schema empty-string and zero fillers count as omitted, while meaningful values remain limited to their action.

All calls are exclusive, so a model-ordered batch observes earlier mutations and their new revisions. UI clients receive pure generic cards: read for `get_goal`, other for mutations. Mutation cards select the first meaningful action value and otherwise show the goal id, so accepted fillers never produce blank input.

All three canonical values match the compact JSON already rendered to Native callers: `{ goal: null }` or `{ goal: { id, revision, objective, phase, roundsStarted, maxGoalRounds, blockedReason? }, activation }`. Programmatic consumers therefore receive the same domain structure without parsing the rendered JSON.

When independent review is configured, a `complete` call remains pending as `Verify delivery` while a fresh one-shot subagent inspects the inherited workspace. The auditor receives the objective and current task list, runs on its configured model route, returns a schema-validated pass/reject verdict, and cannot call editing, delegation, goal, todo, workflow, or Code Mode tools. A rejection or invalid/unavailable verdict leaves the goal active and returns bounded actionable feedback as the failed tool result; a pass with no findings permits the compare-and-set completion mutation.

An autonomous goal round that successfully reports `complete` or `blocked` receives a deferred wrap-up instruction so the assistant still reports the outcome before the ordinary no-tool-calls stop. Direct-human mutations receive no such instruction: the assistant may acknowledge the change and concurrent human steering remains available to the loop.

## Authority

Execution requires the exact live `exec.agent`, its inherited `AgentRegistry` initiator, running status, and an open turn. Create, edit, pause, and resume additionally require an accepted `{ kind: 'user' }` message or steering event in a runtime-root agent's current turn. Durable fork lineage does not demote a resumed root; live subagent ownership does.

`{ kind: 'user' }` is a host attestation. `Agent.followup()` and `steer()` assign it when their caller omits a source, so plugins, schedulers, and other non-human producers must pass their own source rather than inheriting human authority.

Complete and blocked also accept the exact current goal round: a goal-sourced `user/message` whose id, revision, and round equal the folded current goal. A goal-round blocked call is mechanically rejected until `blockedAfterConsecutiveRounds`; the model judges whether the same condition actually persisted and must describe it in `blocked_reason`. Direct human authority may stop a goal immediately.

## Config

```yaml
- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'
  config:
    blockedAfterConsecutiveRounds: 3
    completionRequiresCompletedTodos: true
    completionAuditorProvider: spawn
    completionAuditorModelProvider: google
    completionAuditorModel: gemini-3.6-flash
    completionAuditorMaxTokens: 4096
    completionAuditorMaxAttemptsPerTurn: 2
    completionAuditorReportMaxCharacters: 6000
```

`blockedAfterConsecutiveRounds` must be a positive safe integer. It supplies both the hard lower bound on model self-blocking and the number named in model guidance. When `completionRequiresCompletedTodos` is true, `complete` is rejected unless the current goal has a non-empty `todo_write` list and every item is `completed`; the default is false for backward-compatible compositions.

An empty `completionAuditorProvider` disables independent review. A non-empty value names a one-shot provider on `ctx.subagents`; absence at execution fails closed. `completionAuditorModelProvider` and `completionAuditorModel` are configured together or both omitted to inherit the executor route. The remaining positive safe integers bound output tokens, starts in one parent turn, and feedback characters. The auditor inherits the session workspace and delegated sandbox/approval policy, while its fixed persona forbids source modification and its tool filter removes first-party mutation and recursive orchestration tools.

## Model Experience

### System prompt

#### What the model sees

A fixed goal policy says when semantic human intent warrants creation, requires exact read-before-update refs, explains that a deployment may already have created the goal, explains rearming after resume/fork, and limits completion/blocking claims. Configured blocking, todo-completion, and independent-review rules are interpolated into that guidance.

##### Goal policy

```markdown
Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. A deployment may create the goal automatically for an accepted implementation task, so call get_goal before create_goal or update_goal and copy its exact goal_id and revision. After session resume or fork, an active goal is disarmed: when a human asks to continue or resume in any wording or language, use update_goal action resume to rearm it. Mark complete only when the objective is actually achieved. Mark blocked only after the same blocking condition persists for at least 3 consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, or useful remaining work is not blocked. Completion is rejected until this goal has a non-empty todo_write list and every item is completed. A complete request starts an independent workspace audit. Rejection keeps the goal active and returns actionable findings; correct them and revalidate before requesting completion again.
```

#### Token effect

Small fixed input cost on every request where this plugin's prompt registration is in scope. Each configured completion attempt adds one fresh auditor context and its tool results, bounded by `completionAuditorMaxTokens` and `completionAuditorMaxAttemptsPerTurn`.

#### KV Cache effect

Prefix-stable while the plugin scope, configured threshold, and guidance text are unchanged. Activation, disposal, or configuration changes may invalidate reuse from this prompt section.

### Tool schemas and results

#### What the model sees

The generated [`get_goal`, `create_goal`, and `update_goal` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-goal). Successful results are compact JSON. A mutation appends the goal domain's durable `goal/change` event without queuing model context. `activation` in a result is a live observation and never becomes replay authority.

#### Token effect

Fixed schema cost plus one compact result per call. The durable mutation adds no separate model-visible context.

#### KV Cache effect

Schemas are prefix-stable while their definitions and visibility are unchanged. Calls and results append after the reusable request prefix without invalidating earlier entries.

## Known Limitations and Deferred Work

- **Semantic intent remains model judgment** — execution can prove that the current turn contains a direct human message, not whether the request is substantial enough to merit a goal.
- **Same-condition blocking remains model judgment** — the runtime enforces distinct admitted-round count, not semantic equivalence of obstacles; the completion auditor does not judge blocked reports.
- **Shell validation is instruction-constrained rather than read-only enforced** — mutation tools are removed, but a configured auditor that retains `bash` or `pwsh` can run tests whose scripts create caches or build artifacts. The persona forbids source changes, and delegated approval remains `never`.
- **No scheduling or direct human rendering** — these tools mutate state only; the same-session driver and [`dsh-command-goal`](../command-goal/README.md) are independent consumers of the same domain.
- **Goal-round authority requires a driver** — the autonomous `complete`/`blocked` path is dormant unless a continuation driver admits goal-sourced user turns; mounting this tool package alone does not create them.
- **Prompt registration is independent of filtering** — a scope may hide the tools while retaining their guidance unless the deployment scopes both registrations together.
