---
description: "Tool guard that keeps root filesystem calls inside a Windows target named by the latest direct human message, for maintainers configuring Leon presets."
kind: "package-reference"
---

# @deepseek-ai/dsh-explicit-target-policy

English | [中文](README.zh.md)

## Summary

Monotonic tool guard that keeps root filesystem calls inside an absolute Windows target explicitly named by the latest direct human message in the current turn. It prevents a model from silently replacing a requested target such as `D:/SampleWorkspace/.leon/knowledge` with `.`, the workspace, a parent directory, or another path.

## Table of Contents

- [Plugin (namespace: explicit-target-policy)](#plugin-namespace-explicit-target-policy)
- [Target capture](#target-capture)
- [Enforcement](#enforcement)
- [Security boundary](#security-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="plugin-namespace-explicit-target-policy"></a>
## Plugin (namespace: `explicit-target-policy`)

This package is a function/namespace Cordis plugin (`name` / `inject` / `apply`) over `ctx.tools`. Configure one or more suffix markers that identify protected targets:

```yaml
- id: explicit-target-policy
  name: '@deepseek-ai/dsh-explicit-target-policy'
  config:
    markers:
      - '.leon/knowledge'
    additionalToolRules:
      - name: knowledge_status
        argument: knowledge_root
        requireLock: true
        exact: true
    blockedToolsWhileLocked:
      - glob
      - grep
      - read
      - pwsh
    requiredToolsWhileLocked:
      - knowledge_status
    maxRequiredToolRecoveries: 1
```

`markers` is required and must contain at least one non-blank string. `additionalToolRules` is optional. Each row adds a model tool and its path argument without replacing built-in rules. `requireLock` denies that tool until the latest direct human message establishes a marked target; `exact` denies descendants as well as paths outside the target. `blockedToolsWhileLocked` denies named root model tools for the whole locked turn, including tools without a path argument, so a deployment can require a dedicated bounded interface. Duplicate or blank tool names fail at load time.

`requiredToolsWhileLocked` optionally names path-bearing root model tools whose successful completion is required while a direct-human lock is active. Every required name must have a built-in or `additionalToolRules` path rule and cannot also be blocked; missing rules, duplicate names, and blank names fail at load time. `maxRequiredToolRecoveries` bounds the same-turn continuation count to an integer from 0 through 3. Its default `0` permits no continuation: an incomplete required-tool set immediately ends with `REQUIRED_TOOLS_MISSING` instead of completing the turn.

<a id="target-capture"></a>
## Target capture

On an accepted `agent/pre-step`, the plugin examines only messages whose provenance is exactly `source.kind: user`. Plugin, system, assistant, memory, and tool content cannot establish or replace a target lock.

For every configured marker, capture:

1. normalizes Unicode with NFKC;
2. folds `\` and `/` separators and compares case-insensitively;
3. finds the last Windows drive prefix (`X:/`) before the marker; and
4. records the absolute path from that prefix through the end of the marker.

The latest direct user message in a turn is authoritative. A lock remains active through plugin-only steps in that same turn. A later human turn with no absolute marked target clears it.

<a id="enforcement"></a>
## Enforcement

When a lock exists, the guard applies to root calls only:

| Tools | Path argument |
| --- | --- |
| `glob`, `grep` | `path` |
| `read`, `read_image`, `write`, `edit` | `file_path` |

The original arguments are never rewritten. The call is allowed only when its normalized absolute path is the exact locked target or a descendant. Missing, non-string, relative, `.`, parent, sibling, other-drive, traversal-out, and prefix-collision targets are denied before the tool body runs. The model-visible reason starts with `TARGET_DRIFT` and instructs the model to repeat the call at the exact target.

Deployment-owned rules use the same normalization. A `requireLock` rule fails with `TARGET_REQUIRED` when direct human text did not establish a target; plugin context, history, memory, metadata, and tool results cannot grant one. An `exact` rule accepts only the locked path itself.

A configured `blockedToolsWhileLocked` entry fails with `TARGET_TOOL_RESTRICTED` before its tool body runs whenever a direct-human lock is active. The denial names the protected target and directs the model back to the dedicated Skill tools; it does not rewrite the request or silently select an alternative.

Required completion is per tool and per authorized target: every configured required tool must succeed once on every target captured for the locked turn. Live completion is credited only by the immutable final `tools/result` event for a root execution whose matching `tool/call` is already durable in the same turn and whose configured path argument resolves to that exact target. An `isError` result, a missing durable call, a nested call, or success on a different target does not count.

When `agent/turn-stopping` finds a missing tool-target pair and recovery allowance remains, the plugin calls `agent.steer()` with a correction whose source kind is `explicit-target-policy` that names the missing tools and targets, so the running agent performs another same-turn step. Once `maxRequiredToolRecoveries` is exhausted, the listener throws the stable `REQUIRED_TOOLS_MISSING` error; the protected turn is not allowed to conclude successfully with an incomplete obligation.

At each later pre-step, including after a plugin remount, the policy reconstructs the lock targets, successful tool-target pairs, and consumed recovery count from the same open turn's durable `user/message`, `tool/call`, and `tool/result` events, folded by the `explicitTargetTurn` Session projection rather than by reading Session history. The projection keeps only absolute Windows path arguments of the open turn's calls, so file payloads never enter it, and resume or fork restores it from the log. A new turn or a changed locked target starts a new completion set; durable records from another turn never satisfy it.

Calls without an agent, tools outside the table, and nested subcalls (`parent !== undefined`) are deliberately untouched.

<a id="security-boundary"></a>
## Security boundary

This policy is a deterministic drift barrier, not a filesystem sandbox or an authorization system. It does not inspect a nested tool's internal I/O and does not restrict calls when the latest direct human message did not name an absolute path ending in a configured marker. Pair it with platform permissions and confirmation policies for destructive operations.

<a id="model-experience"></a>
## Model Experience

### Target policy

#### What the model sees

The plugin adds no steady-state prompt text or tool schema. On target drift, the rejected call returns one compact error result beginning with `TARGET_DRIFT:` and containing the normalized target. A protected external-path tool without direct human authority returns `TARGET_REQUIRED:`. A generic tool forbidden during the lock returns `TARGET_TOOL_RESTRICTED:`. A compliant retry remains inside the user-selected tree or uses its dedicated bounded interface. If recovery allowance remains when a locked turn tries to stop, the next same-turn request receives one compact plugin-sourced instruction naming every missing tool and target. If no recovery remains, the turn ends with `REQUIRED_TOOLS_MISSING` instead of presenting incomplete work as a successful conclusion.

#### Token effect

Allowed calls add zero tokens. A denial adds one short model-visible result. Each permitted required-tool recovery adds one compact message and one additional model request; `maxRequiredToolRecoveries` bounds both. The terminal `REQUIRED_TOOLS_MISSING` error adds no recovery request.

#### KV Cache effect

A denial or required-tool recovery is appended after the reusable request prefix, so it does not invalidate earlier KV-cache entries. Reconstructing completion from the durable log adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Windows drive-letter paths only; UNC, device, URI, and POSIX paths are not captured.
- Markers are literal normalized suffix fragments, not globs or regular expressions.
- Additional tool rules declare path-bearing root calls only; they do not inspect a tool's internal I/O.
- Blocking is name-based for the entire active lock; it cannot distinguish a benign use of that tool elsewhere in the same turn.
- Only same-turn durable root calls can satisfy required completion; each required tool must succeed separately on every authorized target, and nested orchestration cannot satisfy the obligation.
- One direct message can establish multiple targets when it contains multiple configured marker occurrences.
- Nested tool orchestration is intentionally the owning tool's responsibility.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. The package was ported from the Leon fork onto DeepSeek Harness 0.2.1; the [replatform Agent Note](../../../.agents/notes/implemented/architecture/2026-10-09-leon-replatform-onto-0-2-1.md) records why its turn state moved into the `explicitTargetTurn` Session projection.

</details>
