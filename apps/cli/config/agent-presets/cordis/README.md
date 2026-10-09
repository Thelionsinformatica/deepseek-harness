# Creator preset

English | [中文](README.zh.md)

The `cordis` preset provides the coding tools and live composition-authoring tools. Its execution authority remains equivalent to shell access; completion review does not make arbitrary authored plugins safe.

## Completion and process safeguards

Goal completion requires a non-empty completed task list for the current goal and a successful independent review through the host's existing `spawn` provider. The host's auxiliary review model selection takes precedence over the inherited route. Review uses Leon's limits: 4096 output tokens, two attempts per parent turn, and 6000 returned feedback characters. Missing task evidence, rejection, invalid structured output, or unavailable review leaves the goal active. The [goal tool](../../../../../packages/goal/tool-goal/README.md) owns these checks and the private evidence-reading tools.

On Windows, `pwsh` refuses host-process termination and requires managed background server startup with a separate foreground health check, as in Leon. Ordinary coding and composition tools remain available. The preset does not rewrite a session's saved sandbox mode, including `danger-full-access`; these tool-level safeguards are not a replacement for sandboxing or approval policy.

## Model experience and limits

The composed goal tools explain the task and review requirements, and rejected completion returns feedback to the coordinator. The independent reviewer receives host-owned evidence and structured-verdict tools, without the coordinator's shell, writing, or composition tools. The preset selects no provider credentials or new model defaults. These policies apply when the preset is mounted; editing its file does not hot-reload an already mounted agent.
