# Agent Note: Packaged desktop artifact launches the verified deployment

Status: implemented

English | [中文](2026-09-18-desktop-packaged-launcher-entry.zh.md)

## Problem

[Electron desktop shell](2026-09-16-electron-desktop-shell.md) shipped `src/main.ts` as the packaged entry: an in-process host that imports `@deepseek-ai/dsh/desktop` and starts the Cordis `web` profile inside Electron's main process. The packaged artifact could not execute that entry. Three independent constraints compose the failure:

- Electron's ESM loader does not resolve imports inside `app.asar`. The asar patch covers `require` (CJS); `import` of relative files and bare specifiers inside the archive falls through to the real filesystem and fails. The same tree extracted to a directory runs correctly; the same bytes inside `app.asar` exit before user code executes.
- electron-builder's default fuse `OnlyLoadAppFromAsar` prevents falling back to a plain `resources/app` directory.
- Under pnpm, electron-builder does not pack the peer-dependency closure of the Cordis plugin graph; even a bundled entry cannot reach dynamically resolved workspace packages.

## Decision

The packaged Windows artifact ships `src/local-main.ts` as its `main` entry: a thin launcher that invokes the existing deployment's `Iniciar-Leon.ps1` (`$env:LEON_ROOT`, default `D:\Leon`) with `-NoOpen`, then loads `http://127.0.0.1:3080` in the same hardened `BrowserWindow` (`contextIsolation`, no Node integration, sandboxed renderer). `src/main.ts` remains the development entry for the in-process host; the packaged shell does not attempt it.

`tsdown` builds each entry alone so rolldown inlines shared chunks; the launcher imports only `electron` and Node builtins, which is the only import profile that survives `app.asar` in this Electron version. `packages/bundle/base/cordis.patch.yml` disables `cordis-plugin-hmr` when `process.argv[1]` is `undefined`, so no-script packaged contexts cannot crash on a missing watch target.

Startup failures write a sanitized lifecycle record to Electron `userData/desktop.log` and flatten nested `AggregateError`/`cause` chains before surfacing a dialog; the log carries no conversations or credentials.

## Alternatives considered

**Bundling the full Cordis runtime into the asar was rejected.** The plugin graph resolves workspace packages dynamically at load; pnpm does not materialize that closure for electron-builder, and ESM resolution inside the archive fails regardless of which packages are staged.

**Disabling `OnlyLoadAppFromAsar` to run directory mode was rejected.** It would weaken the integrity fuse to work around a packaging model the plugin loader does not support.

## Consequences

The packaged artifact is a launcher, not a self-contained install: it requires an existing `D:\Leon` deployment and shares that deployment's settings, sessions, and credentials. This reverses the packaged-entry half of the earlier child-process rejection in [Electron desktop shell](2026-09-16-electron-desktop-shell.md); the in-process design still stands for development. Release artifacts are unsigned until Authenticode secrets exist and must be labeled as such.

## Verification

`pnpm run package` in `apps/desktop` produces NSIS and portable x64 artifacts. Smoke verification launches the packaged `Leon.exe`, confirms the window title `Leon — The Lions Informática`, receives HTTP `200` from `127.0.0.1:3080`, and captures the window through the `leon-windows` UIA connector. `Get-AuthenticodeSignature` on every shipped binary reports `NotSigned`; `SHA256SUMS.txt` is generated alongside the artifacts.

`.github/workflows/desktop-release.yml` builds and smokes the artifacts on Windows runners for every pull request touching `apps/desktop`; publication to GitHub Releases is a manual `workflow_dispatch` through the `desktop-release` environment. The publish job re-verifies that each binary's Authenticode status matches the manifest before creating the release.
