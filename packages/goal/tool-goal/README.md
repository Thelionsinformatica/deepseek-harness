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

The isolated reviewer receives a host-captured JSON trace of parent and direct-child execution. `completionAuditorEvidenceMaxCharacters` (default 24000) bounds each delivery; oversized traces use the paginated review lifecycle below, never silent truncation. Streaming chunks and model reasoning are excluded. Returned text is untrusted evidence, not proof that a child's claims are true. This adds audit input tokens without changing ordinary-turn prompts.

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
    completionAuditorTools: []
    completionAuditorArtifactMaxFiles: 64
    completionAuditorArtifactMaxBytes: 1048576
    completionAuditorRequireArtifacts: true
```

`blockedAfterConsecutiveRounds` must be a positive safe integer. It supplies both the hard lower bound on model self-blocking and the number named in model guidance. When `completionRequiresCompletedTodos` is true, `complete` is rejected unless the current goal has a non-empty `todo_write` list and every item is `completed`; an incomplete-list rejection returns that full canonical list, including completed entries, so a retry can preserve every content string and relative order, update statuses, and retain legitimate newly discovered items. The default is false for backward-compatible compositions.

An empty `completionAuditorProvider` disables independent review. A non-empty value requires a one-shot provider advertising host `setup` support; absence fails before inference. `completionAuditorModelProvider` and `completionAuditorModel` are configured together or both omitted to inherit the executor route; a composed auxiliary `review` selection takes precedence. Positive safe integers bound output tokens, starts per turn, feedback, and artifact evidence. Delegated sandbox/approval policy remains inherited.

`completionAuditorTools` defaults to an empty allowlist. The host installs a child-scoped execution guard before publication or inference: only `completion_evidence_read`, `completion_artifact_read`, `structured_output`, and explicitly configured verifier tools are allowed. The guard also checks child-owned and nested calls that an inherited tool filter cannot contain. Extra names must exist in the parent's tools; use narrowly implemented read-only verifiers, not general shells. The host remains responsible for their implementations.

`completion_artifact_read({ file_path })` returns the full UTF-8 file, byte count and SHA-256 through the current `ctx.fs` provider. It confines reads to the assigned workspace, rejects conventional credential paths, Windows stream syntax and binary/oversized content, and records only successful unchanged final deliveries. Colons are reserved for a leading Windows drive designator, including extended paths; other colon-bearing names are unavailable on every provider. Ordinary drive and UNC paths remain subject to workspace containment. Defaults are 64 paths and 1048576 bytes per file. `completionAuditorRequireArtifacts` defaults to false for non-file goals; setting it to true requires at least one delivered file, not merely a textual PASS.

## Review lifecycle

`update_goal action: review` runs the configured auditor without completing the goal or changing any todo. Pending review bookkeeping therefore does not require a false completion claim. A successful result includes `review.status`, the auditor session id, and its bounded summary. After recording the remaining checklist status, `complete` reuses this PASS only in the same open turn and exact goal revision, with unchanged task content and no intervening work tools. New work, a new turn, or changed requirements require a fresh review. Incomplete todos still block completion.

The auditor receives host-captured parent calls/results and direct-child execution, including recorded model sources, through live sessions and optional persistence. Coverage explicitly states `live-only` or `live-and-persisted`. Evidence larger than `completionAuditorEvidenceMaxCharacters` is delivered through `completion_evidence_read` in bounded numbered pages. Access belongs only to the exact assigned auditor and expires on settlement. The host refuses PASS unless every page was delivered; delivery does not prove understanding. A page budget too small for its envelope fails before inference. The original session records are never truncated or rewritten.

New receipts include an `artifacts` manifest with `files-reviewed` or `no-files-reviewed` coverage. Full bytes and provider target identities are rechecked after review and again before same-turn reuse. Changed or missing files refuse completion with `GOAL_QUALITY_AUDIT_ARTIFACT_STALE`; the executor must explicitly obtain another review. Legacy receipts remain readable but cannot authorize reuse. No file content is stored in the receipt; the child tool result is still logged as ordinary evidence. See the [audit-boundary decision](../../../.agents/notes/implemented/bug-fix/2026-09-21-completion-audit-boundaries.md).

## Model Experience

### System prompt

#### What the model sees

A fixed goal policy says when semantic human intent warrants creation, requires exact read-before-update refs, explains that a deployment may already have created the goal, explains rearming after resume/fork, and limits completion/blocking claims. Configured blocking, todo-completion, and independent-review rules are interpolated into that guidance.

##### Goal policy

```markdown
Use goal tools only for one long-running objective; skip routine single-turn work. create_goal may infer goal intent from a direct human request in any language. A deployment may create it automatically: call get_goal first, then use exact goal_id/revision. Resuming a session or forking it disarms an active goal; any human continue or resume request in any wording or language requires update_goal action resume. Complete only when achieved. Block only after the same condition lasts at least 3 consecutive goal rounds; set blocked_reason. Difficulty, uncertainty, or remaining work are not blockers. Completion needs a non-empty todo_write list with all items done. An incomplete-list rejection returns the complete canonical list; preserve content/order, update statuses, retain legitimate new items, then retry. Use action review to request independent review before marking review bookkeeping completed. A successful review leaves the goal active and never completes todos. Then finish bookkeeping and call complete in the same turn without other work. Complete reuses that current PASS; otherwise it starts a fresh audit. Never mark a review todo completed before PASS. If rejected, fix findings and revalidate before retrying.
```

#### Token effect

Small fixed input cost on every request where this plugin's prompt registration is in scope. Each configured completion attempt adds one fresh auditor context and its tool results, bounded by `completionAuditorMaxTokens` and `completionAuditorMaxAttemptsPerTurn`.

#### KV Cache effect

Prefix-stable while the plugin scope, configured threshold, and guidance text are unchanged. Activation, disposal, or configuration changes may invalidate reuse from this prompt section.

### Tool schemas and results

#### What the model sees

The generated [`get_goal`, `create_goal`, and `update_goal` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-goal). Successful results are compact JSON. A rejected completion with unfinished tasks includes the complete canonical `todo_write` list. A mutation appends the goal domain's durable `goal/change` event without queuing model context. `activation` in a result is a live observation and never becomes replay authority.

#### Token effect

Fixed schema cost plus one result per call. Successful results are compact; an unfinished-task rejection scales with the current list. The durable mutation adds no separate model-visible context.

#### KV Cache effect

Schemas are prefix-stable while their definitions and visibility are unchanged. Calls and results append after the reusable request prefix without invalidating earlier entries.

## Known Limitations and Deferred Work

- **Evidence scope** — direct-child evidence is not recursive. Without persistence, cold children cannot be verified. Hashes cover files actually read, not every required artifact or semantic correctness. They detect observed changes, not writes after the last check; there is no workspace lock or global writer barrier. Empty coverage is not file verification.

- **Semantic intent remains model judgment** — execution can prove that the current turn contains a direct human message, not whether the request is substantial enough to merit a goal.
- **Same-condition blocking remains model judgment** — the runtime enforces distinct admitted-round count, not semantic equivalence of obstacles; the completion auditor does not judge blocked reports.
- **Host extensions remain trusted** — the allowlist is not an operating-system sandbox for malicious host plugins. Explicitly granting a general shell defeats read-only intent. Credential-name filtering is not universal secret detection. File contents follow the configured auditor's model route, including a configured external provider.
- **No scheduling or direct human rendering** — these tools mutate state only; the same-session driver and [`dsh-command-goal`](../command-goal/README.md) are independent consumers of the same domain.
- **Goal-round authority requires a driver** — the autonomous `complete`/`blocked` path is dormant unless a continuation driver admits goal-sourced user turns; mounting this tool package alone does not create them.
- **Prompt registration is independent of filtering** — a scope may hide the tools while retaining their guidance unless the deployment scopes both registrations together.
