# Agent Note: Electron desktop shell — native window over the existing Web host

Status: implemented

English | [中文](2026-09-16-electron-desktop-shell.zh.md)

## Problem

Leon already provides a complete Web client and a local Cordis host. A desktop distribution needs a native window, local lifecycle ownership, and a Windows installer without duplicating the Web UI or weakening the renderer's access to the filesystem.

## Decision

`apps/desktop` (`@deepseek-ai/dsh-desktop`) is an Electron application. Its main process imports the public `@deepseek-ai/dsh/desktop` entry, starts the shipped `web` profile in-process on `127.0.0.1` with an OS-assigned port, and loads that origin in a hardened `BrowserWindow`.

The renderer uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Same-origin navigation remains inside the window. External navigation is opened by the operating system and is never handed Node.js access.

The desktop entry passes `--no-open`, `--host 127.0.0.1`, and `--port 0` to the existing Web startup service. The Cordis `ProcessShutdown` controller disposes the host before Electron exits, so closing the native window does not leave a local server running.

The first package target is Windows NSIS x64 with application id `br.com.thelions.leon`. The shell reuses the existing `$DSH_HOME`, profiles, credentials, workspace configuration, permissions, and session persistence. Additional native APIs require an explicit preload bridge and must not be exposed through renderer Node integration.

The packaged Windows build registers `openAtLogin` through Electron's login-item API during boot. Development launches do not register auto-start, and the login entry opens the normal desktop window after the user session begins.

## Alternatives considered

**A separate native UI was rejected.** Reimplementing the existing React surface would duplicate session rendering, RPC behavior, and accessibility logic.

**A child `dsh` process was rejected.** Keeping the host in Electron's main process gives the shell one lifecycle owner and lets shutdown dispose the Cordis tree without signal and port-discovery races.

**Tauri was deferred.** It would reduce runtime size, but it introduces a second native toolchain before the existing Node host has a desktop lifecycle contract.

## Consequences

The desktop build depends on Electron and currently targets Windows NSIS x64. The renderer remains a loopback Web client, so browser and desktop behavior share the same host and can be validated with the existing Web tests. The package is private and excluded from the npm release family; the installer is produced separately by electron-builder.

## Verification

`apps/desktop/tests/config.spec.ts` covers same-origin and external navigation decisions. The repository build must complete before the desktop shell starts because the Web profile resolves the built frontend distribution. `pnpm run desktop:package` builds the repository, compiles the shell, and invokes electron-builder for the Windows installer.
