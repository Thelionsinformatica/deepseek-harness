# Agent Note: Leon replatforms onto DeepSeek Harness 0.2.2

Status: implemented

English | [中文](2026-10-29-leon-replatform-onto-0-2-2.zh.md)

## Problem

The [0.2.1 replatform](2026-10-09-leon-replatform-onto-0-2-1.md) left Leon on the `dsh-v0.2.1-alpha.2` tag. By 2026-10-28 upstream had published `dsh-v0.2.2-alpha.2`, 3,166 commits and eight tags later (`0.2.1-alpha.3`, `alpha.4`, `alpha.5`, `rc.1`, `rc.2`, `rc.3`, `rc.4`, `0.2.2-alpha.2`). `leon/replatform-0.2.1-alpha.2` was 15 commits ahead and 3,166 behind, so merging was still the wrong shape and the fork kept drifting.

The 0.2.2 line changed four seams the ported work sits on:

- `SessionProjections.stateOf(session, key)` is deprecated and now returns `unknown`; a unit is read through the awaited registration handle (`handle.stateOf(session)` / `handle.readerFor(session)`).
- Tool batches moved from one call per `ToolsService.execute({ callId, name, arguments, signal })` to `ToolBatchInput { calls, signal }` / `ToolBatchResult { results, … }`, with `executeToolFixture` and `executeModelToolFixture` as the test entry points.
- `defineContentToolFixture` left `@deepseek-ai/dsh-tools` for `@deepseek-ai/dsh-tool-testkit`.
- `KvTable` gained `deleteMany`, and the credentials document now tolerates a foreign top-level key (`ignoredKeys`) instead of rejecting it.

## Decision

Leon is rebuilt on `dsh-v0.2.2-alpha.2` in a fresh worktree, branch `leon/replatform-0.2.2-alpha.2`, by porting the 15 commits of `leon/replatform-0.2.1-alpha.2` in the same layers as last time: Leon-only packages, then the Leon bundle and preset, then edits to upstream files, then generated documentation.

The 15 Leon-only packages (`packages/bundle/leon`, `client/language-pt-br`, `client/ui-web-access`, the four `guard` policies, `knowledge/tool-knowledge-base`, the six `memory` packages, `web/web-access`) copy across unchanged except for the 0.2.2 conventions: `SessionProjections.register` is awaited in an async `apply` or `[Service.init]` and the handle owns every read, fixture imports come from `dsh-tool-testkit`, and `KvTable` implementations add `deleteMany`.

Edits to upstream files are re-applied rather than merged:

- `credentials-local` keeps Leon's Windows DPAPI version-2 envelope on top of 0.2.2's document rules: unknown top-level keys are retained and warned about, `resolve`/`describe` prefer the managed store over the inherited environment, and `assertUnshadowed` is gone.
- `storage-domain` keeps upstream's `deleteMany` next to the fork's `KvTable.mutate()`.
- `official-bundles` lists `@deepseek-ai/dsh-leon` in `OPTIONAL_BUNDLES`; the `PROFILE_TEMPLATES` block the fork used to extend now lives in that package.
- `app-boot/profile.ts` needs no fork edit at all.
- The gate scripts (`check-workspace-constraints`, `gen-doc-graphs`, `gen-tool-catalog`, `verify-package-readme-model-experience`) take the Leon rows they took in 0.2.1.

Workspace manifests carry the root version `0.2.2-alpha.2`, because `check-workspace-constraints` rejects any dsh-family manifest that disagrees with the root.

## Alternatives considered

**Merge `upstream/master` into the 0.2.1 branch.** The 0.2.1 note already measured a direct merge at 858 conflicted paths; the 3,166-commit gap makes that worse, and the projection, batch, and fixture APIs would still need the same edits.

**Stay on 0.2.1 and cherry-pick fixes.** Leon would keep drifting, and the projection deprecation would start logging on every read.

**Port only the packages and leave the upstream-file edits out.** The Leon profile mounts memory and guard services that depend on the `storage-domain` `mutate` primitive and on the credentials envelope, so the branch would activate but not behave.

## Consequences

- The deployed 0.2.1 build keeps running until the ported branch passes validation; nothing switches automatically.
- Generated catalogs (`tool-cordis/src/api-catalog.ts`, `docs/tool-catalog.md`, the doc graphs, the bundle and plugin catalogs, the skill package reference) are regenerated from the ported sources rather than merged.
- Every ported package keeps its own `stateVersion`; the projection handles are per-plugin, so a second registration under the same key still fails loud.
- The `apps/desktop` build still needs its own verification before an installer is produced.

## Verification

- `pnpm run build` passes all ten build gates: native addon, Host Typert, host and client compilers, host and client bundles, the desktop bundle, both aggregate checks, and the Web build.
- `pnpm run typecheck` passes all five gates, and `pnpm run lint` reports no errors.
- `pnpm install` resolves every workspace project with the 15 ported manifests, and every `@deepseek-ai/*` dependency of a ported package resolves inside the workspace.
- Focused package tests run with `vitest run packages/memory packages/guard packages/knowledge packages/web/web-access packages/credentials/credentials-local packages/storage/storage-domain packages/mcp/mcp-client`: 56 files and 919 tests pass. The MCP negotiation lifecycle spec is timing-sensitive under a loaded parallel run and passes alone.
- Generated catalogs are refreshed with `gen-cordis-catalog`, `gen-doc-graphs`, `gen-tool-catalog`, `gen-plugin-packages`, `gen-official-bundle-catalog`, `gen-config-catalog`, `gen-persistence-catalog`, `gen-tsconfig-paths`, and the translation-pairing writer.
- `pnpm run doc-sync` passes every gate that depends on the tree. Two gates depend on the machine instead: `verify-repository-references` resolves a seven-digit size literal in `python/sdk/uv.lock` against this clone's object database, where it now collides with a commit prefix, and the documentation-site spec creates a symlink, which needs `SeCreateSymbolicLinkPrivilege` on Windows.
