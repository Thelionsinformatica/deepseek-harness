# Agent Note: Leon replatforms onto DeepSeek Harness 0.2.1

Status: implemented

English | [中文](2026-10-09-leon-replatform-onto-0-2-1.zh.md)

## Problem

The Leon fork branched from upstream on 2026-08-21 and stopped following it. By 2026-10-09 it was 8,258 commits behind `dsh-v0.2.1-alpha.2`. A direct merge produced 858 conflicted paths: 582 content conflicts, 199 modify/delete conflicts, and 70 file-location conflicts. Upstream had deleted or moved most of the files the fork edited most heavily, including the API proxy files that held Leon's model routing and the client runtime files, and it removed the runtime-invariant plugins every Leon package depended on.

## Decision

Leon is rebuilt on the release tag instead of merged into it. The branch `leon/replatform-0.2.1-alpha.2` starts at `dsh-v0.2.1-alpha.2`, and Leon's work is ported layer by layer: Leon-only packages first, then the Leon preset and profile, then the remaining edits to upstream files, one area at a time. An edit whose purpose upstream already serves is dropped instead of ported. The previous state stays recoverable from the branches `leon/self-improve-20260925` and `leon/wip-snapshot-20261009`.

A ported package drops its `invariant.ts` entry, since upstream removed that plugin family, and adopts upstream workspace conventions. A ported plugin that read Session history synchronously moves that state into a Session projection, following the [synchronous-read deprecation](2026-09-09-deprecate-synchronous-session-event-reads.md). The first package ported this way is [`dsh-explicit-target-policy`](../../../../packages/guard/explicit-target-policy/README.md): the `explicitTargetTurn` projection folds the open turn's direct-human text, its own recovery notices, and the absolute path arguments of its tool calls. A plugin-injected message declares its own `MessageSourceMap` kind instead of the removed generic `plugin` kind.

The memory packages keep their behavior. `dsh-tool-memory` reads Session facts through two projections: `toolMemoryRecall` holds the snapshots it injected and the latest direct-human text, and `toolMemoryProcedureEvidence` holds open-turn human text plus the latest 128 tool calls, without arguments longer than 65,536 characters. Procedure proposals can therefore cite only recent calls. The personal-memory enablement preference, previously a settings namespace, is the volatile `personalMemoryEnabled` field of the review service entry. Leon logs written before 0.2.1 migrate the old `plugin` source to the runtime-only kinds `plugin:tool-memory` and `plugin:explicit-target-policy`, which both projections accept. `dsh-storage-domain` regains the fork's atomic `KvTable.mutate()` that memory writes depend on.

## Alternatives considered

**Merge upstream and resolve every conflict.** Most conflicts sit in code upstream has since deleted or restructured. Resolving them would preserve edits against APIs that no longer exist and would take longer than porting.

**Cherry-pick selected upstream fixes onto the old base.** This keeps Leon off the current release, and the gap grows with every upstream release.

**Keep the deprecated synchronous reads in ported plugins.** The lint gate rejects new calls, and the decision exists so Session history need not stay resident.

## Consequences

- The Leon deployment keeps running the old build until the ported branch passes validation; nothing switches automatically.
- Until every layer is ported, the ported branch lacks Leon features such as the completion-claim and failure-recovery policies and the Leon preset.
- Each ported plugin with a projection owns a `stateVersion` that must change whenever its folded fields or fold semantics change.

## Verification

- `dsh-explicit-target-policy`: `vitest run packages/guard/explicit-target-policy` passes 48 tests, including same-turn reconstruction and recovery-count tests that now read the projection; `tsc -b packages/guard/explicit-target-policy` and the staged oxlint configuration report no errors.
- Memory: `vitest run packages/memory packages/guard packages/storage/storage-domain` passes 478 tests, including projection tests for legacy kinds and the evidence window.
