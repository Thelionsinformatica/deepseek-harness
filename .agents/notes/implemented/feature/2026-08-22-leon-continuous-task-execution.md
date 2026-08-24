# Agent Note: Leon continuous task execution

Status: implemented

English | [中文](2026-08-22-leon-continuous-task-execution.zh.md)

## Problem

Leon can receive a substantial implementation request, publish a task list, and still stop after one short turn because continuation previously depended on the model choosing to call `create_goal`. The task panel then retained an in-progress item without distinguishing active execution from an idle agent. This created two false impressions: that visible tasks guaranteed continued work, and that an animated pending item proved work was still running.

## Decision

The Leon preset opts into deterministic automatic goal admission in `goal-round-driver`. After downstream prompt policy accepts a direct-human root message, implementation requests with an unambiguous execution verb and a concrete work target, persistence language, or substantial structure create one persisted goal with a twelve-Round cap when no unfinished goal already exists. Ambiguous nouns such as `teste`/`test` do not count as execution by themselves, and explicit no-edit or no-tool analytical probes stay single-turn. A short `responda apenas`/`answer only` probe also remains single-turn, while that phrase later in an otherwise executable implementation request does not suppress work. Other presets remain unchanged.

Automatic Goal Rounds retain the same `todo_write` projection. At every continuation boundary, their prompt requires the model to reconcile that plan with inspected workspace artifacts and the latest failed or missing verification before writing, preserve existing items, and continue from the first unfinished item instead of recreating earlier work. It accepts only actual tool results as command evidence and requires requested runtime checks to run again after the final change. Leon additionally configures `todo_write` with `preserveExistingItems: true`: later writes may insert discovered work and update statuses, but cannot remove, rename, reorder, or reopen existing completed items. A later direct-human message clears the previous plan because it begins a new human task. Leon's `tool-goal` composition enables `completionRequiresCompletedTodos` and a fresh `spawn` completion auditor routed to Google Gemini. A completion mutation therefore requires an all-completed non-empty task list plus an independent structured PASS with no findings; rejection returns corrections to the active Goal Round and never publishes terminal state.

Goal Round instructions treat local servers as managed background jobs. One background call contains only the server start command, the HTTP health check runs in a separate foreground call, and the model stops only the returned job handle. This prevents a long-lived server from blocking the health check placed after it in the same shell command. The Leon preset enforces that sequence with `enforceManagedServerValidation: true` for recognized server commands, rejecting foreground server starts, nested PowerShell jobs, and combined server-plus-health calls before shell resolution. A failed or refused health check requires reading the returned server job output before changing ports, making server stderr the primary runtime evidence. An occupied port selects another port or becomes a reported conflict, never a reason to terminate the existing owner. On Windows the Leon preset also configures `tool-pwsh` with `allowHostProcessTermination: false`, so common direct process and service termination forms fail before shell resolution. These syntax policies are defense in depth; the Windows sandbox and approval policy remain the authority for host access.

The Web task panel combines the authoritative todo projection with the session running bit. An incomplete list reads `Leon is working` only while the agent is running and `Leon stopped — task incomplete` while idle; an all-completed list reads `Work completed`. A blank automatic session primes the fast local route before its model state is displayed, while prompt admission may move the active turn to the main local tier. The selector continues to show the actual current route and effort.

## Alternatives considered

**Rely on the model to call `create_goal`.** Rejected because the failure being corrected is precisely that smaller local models may omit the call even when the requested work is clearly multi-step.

**Treat every user message as a persisted goal.** Rejected because questions, short replies, and health probes should finish in one turn and must not consume automatic Round budget.

**Keep the task spinner active whenever an item is in progress.** Rejected because todo status is model-authored plan state, not proof that the agent process is running.

**Allow completion with no task list.** Rejected for the Leon preset because it would preserve the previous false-success path. Other compositions retain backward compatibility by leaving the gate disabled unless configured.

**Rely only on prompt guidance for occupied ports.** Rejected because a smaller local model may still issue a termination command after observing a conflict. The Leon executor denies common direct forms before any process starts.

**Disable direct process control in every preset.** Rejected because generic compositions may intentionally manage host processes. The default remains enabled and Leon opts into the stricter policy.

## Consequences

Substantial Leon implementation work continues in the same session without the user typing “continue,” up to its configured cap or a concrete terminal state. The visible plan survives those internal rounds and truthfully distinguishes working, stopped-incomplete, verifying, and completed states through the running completion tool card. State reconciliation reduces repeated work after a long turn or compaction, while post-change runtime evidence and a fresh Gemini auditor reduce false completion from the executor's own assumptions. The three-call server protocol avoids foreground hangs and prevents the usual port-conflict recovery from targeting unrelated Windows services. The auditor remains a model judgment rather than a cryptographic completion certificate.
