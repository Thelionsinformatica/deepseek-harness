# @deepseek-ai/dsh-experimental-agent-team

English | [中文](README.zh.md)

Implicit-root Agent Teams domain. `ctx.agentTeams` owns a flat Lead/teammate roster, a durable peer mailbox, and a shared task DAG in the Lead Session log. The [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns the coordination and isolation decisions; the [Team subsystem catalog](../../../docs/subsystems/agent-team.md) records the literal durable shapes and service API.

## Config

Admission rejects absent providers and providers without `prepareContinuable` before reserving a member name or slot. Failures after admission remain durable failed members, including removal of a provider during provisioning.

```yaml
- id: agent-team
  name: '@deepseek-ai/dsh-experimental-agent-team'
  config:
    maxMembers: 8
    maxTasks: 256
    maxPendingMessagesPerMember: 64
    maxMessageBytes: 65536
    disposalTimeoutMs: 5000
    completionRequiresReview: false
```

Every limit must be a positive safe integer. `maxMembers` counts every name ever provisioned, including failed members, because names are never reusable. `maxTasks` counts non-deleted tasks. The mailbox limit is per target; the byte limit covers the complete framed delivery, including its stable id and sender name. `disposalTimeoutMs` bounds admitted creation, mailbox dispatch, and Team-owned Activation settlement so plugin reload and process shutdown fail visibly instead of waiting forever.

The service requires Agent, Session, Session persistence, and continuable-subagent services. A composition without durable Session storage does not activate it.

## Team identity and roster

Every ordinary runtime root is the implicit Lead of a Team whose `TeamId` equals its `SessionId`; creating a Team is therefore state-free until the first member, message, or task record. A teammate is a named, continuable direct child recorded in that root's Session. Names are lowercase kebab-case, at most 64 characters, and immutable for the Team lifetime. Session ids remain the persistence and authorization identities.

`spawnTeammate()` first appends and flushes a provisioning member, then asks the configured spawn or fork provider to create the reserved child id. A provider failure appends a durable failed member. Successful inbox admission is flushed in the child Session before the active edge commits. On root recovery, a provisioning record becomes active only when the independently persisted child has matching direct-parent and continuable descriptors plus its initial user message, either still pending in the durable inbox or already recorded in history; otherwise it becomes failed. If recovery wins a same-process provisioning race, the creator accepts the matching terminal state or reports `TEAM_PROVISIONING_CONFLICT` and drains a child that recovery already marked failed. Disposal closes admission, aborts and awaits admitted creation and mailbox-dispatch transactions, then asks the continuation owner to release the roster's exact live direct children and their descendants. Non-Team continuable children of the Lead remain untouched. Cleanup failures make disposal fail visibly. This closes crashes and reload races between root provisioning and its terminal member edge without reusing a name or retaining an orphan Activation.

Fresh children have no parent-history seed. Fork children capture the Lead's completed-turn prefix once; the in-flight delegation turn is excluded. Inherited Team records carry the old root's `TeamId` and are ignored when an ordinary fork becomes an independent runtime root. Provider-owned subagents outside the roster do not become nested Team Leads.

The roster reports durable provisioning/failed phases and live `running`/`idle` status. An active but non-resident teammate is `inactive`; later waking delivery cold-resumes it through the continuation owner.

## Durable mailbox

`sendMessage()` validates peer membership, appends `team/message/queued`, and flushes before attempting delivery. The result always identifies that durable message; `queued` means immediate delivery was deferred and is not an instruction to resend. Quiet delivery injects, flushes, and acknowledges context immediately when the target is live, but never activates an inactive target; an inactive target's quiet message remains queued. Wakeup delivery becomes the target's next FIFO turn and cold-resumes it when needed.

The target message begins with `Team message <id> from <name>:` and retains the same id and sender in `TeamMessageSource`. Once the target Session durably holds that identity either in its pending inbox or recorded user-message history, the Lead log appends `team/message/delivered`. Immediate admissions are serialized per target in durable queue order, and recovery dispatches queued-minus-delivered records in the same order. Delivery folds both live and persisted inbox/history state before retrying, so a crash between inbox acceptance and model claim does not duplicate the message. A successful Lead-log flush wakes current `waitForChange()` callers, which then re-list authoritative state.

The guarantee is process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery. This release has no shared mailbox transaction across processes and no mailbox timeline UI.

## Shared task board

Tasks are complete versioned snapshots. Every mutation carries `expectedRevision`; stale callers receive `TEAM_TASK_STALE_REVISION` instead of overwriting a newer value. Any member can create, read, or claim a ready unowned task. The owner or Lead can edit, release, complete, reopen, or delete it; only the Lead can assign another member. Numeric `task-<n>` ids require a safe-integer suffix; creation reports `TEAM_TASK_LIMIT` instead of reusing the final safe id.

Dependencies must name current non-deleted tasks and form a complete DAG with no self or duplicate edge. A pending task is ready only after every blocker completes. Deleting a task that still has a non-deleted dependent is rejected. Deleted tasks remain tombstones for replay and id stability but do not consume `maxTasks` or appear in `listTasks()`.

`writeScopes` are normalized workspace-relative prefixes. Views warn when they overlap an in-progress task, but they never block claim or authorize filesystem writes. They are coordination hints, not locks.

With `completionRequiresReview: true`, completion also requires the sole host reviewer registered through `registerCompletionReviewer()`. The task transaction checks the current revision before invoking the reviewer and remains serialized until the review settles. Missing, rejecting, throwing, or revoked reviewers cannot complete a task or release its dependents. The reviewer owns evidence validation and must be bounded, must not mutate the same Team, and must revalidate its durable evidence after restart. Registration is a disposable host capability, not a model tool or persisted approval. This option alone does not implement mission budgets, STOP, artifact verification, or filesystem isolation.

`waitForChange()` waits for one roster, task, mailbox, or live-status edge that occurs after registration, for 10 seconds through one hour; it reports only whether the wait timed out and does not replay a change that already happened. Runtime disposal releases current waits and makes later waits return immediately without a timeout. Callers re-read authoritative state after wakeup or timeout. Cancellation preserves an Error reason or reports a non-Error reason through `TEAM_WAIT_ABORTED` with structural inspection instead of object coercion. `interrupt()` is Lead-only and delegates to the continuable-subagent interrupt path, which cancels only a live teammate's current turn with `keepInbox`; it neither releases task ownership nor deletes durable mail.

The separate `./invariant` companion replays each candidate Team event against its committed Session prefix. Replay validates every current-version Team payload before it enters folded state, then rejects invalid member transitions, reused names, out-of-range numeric task ids, discontinuous task revisions, invalid task dependencies, duplicate queue/ack records, and acknowledgements with the wrong target before append. Session event `seq` and `time` own ordering and timing instead of duplicated snapshot timestamps.

## Optional mission control

The separate `./mission-control` Loader entry provides `ctx.teamMissions` over native `storageDomain`. Configure `domainName`, `owner`, an absolute `workspace`, `maxCalls`, and `durationMs` explicitly. It is not mounted by the normal Team entry. Tasks and messages remain authoritative in their existing Session journal.

The host starts a mission with frozen objective, criteria, deadline and call ceiling. Atomic reservations consume attempts before dispatch; concurrent callers cannot exceed the stored ceiling. Revision-checked pause/resume preserves consumption and deadline. STOP is terminal for that root and survives reopening the storage backend; a new start cannot reset it. Another owner or workspace cannot reuse the record.

This entry is a control ledger, not a complete executor: it does not intercept model calls, cancel active subprocesses, serialize inference, enforce local routing or restrict filesystem writes. The host must connect those boundaries before enabling a mission. Concurrent processes sharing the same storage are unsupported. `team.cordis.snapshot.yml` exercises this entry with a deterministic adapter, not a local model.

## Isolated import laboratory

Terminal STOP commits against the latest mission revision, so concurrent call reservations cannot reject a stop requested with an older revision. Pause/resume still require the observed revision. A verifier exception pauses without approval, preserves the original limits, and allows explicit resume after inspection. Concurrent STOP wins over both successful and throwing verification. A process crash in `reviewing` still requires operator reconciliation.

`mission_task` starts or submits the calling worker's native task with host-resolved revision. Concurrent starts serialize without duplicating the task; completion still invokes the native evidence reviewer. The lab hides generic task mutation tools and also denies them at final dispatch. There is no second task store.

`mission_task_complete` is a compatibility alias using the same phase argument and reviewer. Eight steps per turn return control to the host without renewing the mission budget. Final review atomically closes new inference admission before collecting evidence; a crash in `reviewing` does not auto-approve or auto-resume.

`examples/headless-agent/collective.cordis.yml` composes `./execution` and `./import-lab` separately from the normal profile. Execution checks mission state, a fixed provider/model pair and a final tool allowlist, serializes generations, reserves calls before dispatch, and cancels active turns on pause/STOP. The deployment must verify the actual local server; a loopback URL alone is not proof of local inference.

`lib/lab-bin.js run <absolute-empty-directory> <absolute-config>` creates an exclusive owner lock and a bounded import-policy fixture. It reuses native Team sessions, tasks and messages. Only Lead can patch that fixture with a current digest. No arbitrary code, shell, filesystem or network tool is exposed. Host verification checks current output, completed tasks and worker verification after receipt of peer evidence. This is a narrow demonstration, not a general coding sandbox or production integration.

The runner accepts `status`, `pause` and `stop` on stdin. After exit, `resume` accepts only paused missions; STOP is terminal and persists. Offline `status` and `stop` use the same directory/config. A leftover `.owner.lock` after a crash requires operator reconciliation after checking its PID; never delete a live owner's lock. Neither resume nor corrective feedback renews the original budget or deadline.

The stdin pause controller retries stale revisions while the mission remains running, bounded by the remaining call allowance plus one. Other failures propagate to stderr; only a committed control change is acknowledged on stdout. The service retains revision checks for pause and resume. This does not provide abrupt-crash recovery.

The lab injects a durable native context snapshot containing actual identity, roster and task views. This adds context tokens and changes the dynamic suffix without rewriting static identity. Tool results and peer deliveries remain in ordinary session logs. The deterministic Loader test proves composition, not Qwen capability or hardware performance.

The optional execution setting `reviewReserve: { calls, reviewerName }` reserves the final positive number of mission calls for the named teammate, excluding Lead. It must leave at least one ordinary call. The executor checks the persisted counter after acquiring its inference slot and before reserving a call; denied attempts do not consume budget. Omission preserves ordinary admission. This does not schedule a review, ensure a valid artifact, or prevent the reviewer from spending its allocation on unrelated work. The host must request and verify final evidence; direct host reservations and concurrent runtime processes are outside this executor policy.

## Model Experience

### Peer messages

#### What the model sees

Each delivered peer message is a user-role message. A short first text block names its stable message id and sender; the sender's original content blocks follow unchanged. Roster, task, and mailbox records themselves are log-only and never enter derived model history.

#### Token effect

Each peer delivery adds the sender prefix plus message content to the target history. Task and roster mutations add no model tokens; their model-facing representation belongs to `@deepseek-ai/dsh-experimental-tool-agent-team` results.

#### KV Cache effect

Peer messages append after the target's reusable history prefix. Cold resume reuses the persisted conversation before appending a previously undelivered item.

## Known Limitations and Deferred Work

- **One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock.
- **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.
- **Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse.
- **No automatic ownership release** — idle, interruption, process exit, and failed work do not release a task owner.
- **Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported.
