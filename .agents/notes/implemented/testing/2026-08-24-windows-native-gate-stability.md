# Agent Note: Windows-native gate stability

Status: implemented

English | [中文](2026-08-24-windows-native-gate-stability.zh.md)

## Problem

The complete unit and snapshot gates were not reproducible on a native Windows checkout even though the affected suites passed individually. Directory symlink creation required a privilege ordinary Windows installations do not grant, Bash-only scenarios attempted to boot without Bash, nested JSON text retained doubled Windows path separators, and unrestricted fork or ACP concurrency starved subprocess deadlines or triggered libuv's `UV_HANDLE_CLOSING` assertion during concurrent child shutdown. These host failures obscured product regressions and left the Leon fork unable to prove a clean local baseline.

## Decision

Directory-link tests use Windows junctions while retaining symlinks on other hosts. Tests whose contract specifically requires a file symlink skip on Windows and continue to run on non-Windows CI. Snapshot suites and headless examples probe Bash availability and skip only scenarios whose committed command dialect requires Bash; native PowerShell coverage remains enabled.

Snapshot and JSON-RPC normalization now recognizes both literal Windows cwd spellings and their JSON-escaped representation, then canonicalizes repeated path separators only in cwd-rooted or explicitly path-bearing text. The regression suite pins a Windows path embedded as JSON text inside a session event. The DeepSeek Files offload snapshot likewise canonicalizes only its `<path>` value.

Native Windows unit gates use at most four fork workers with platform-specific test and cleanup deadlines, leaving process headroom for Codex, ConPTY, Git, and SQLite fixtures. Snapshot replay uses at most two file workers and one concurrent scenario within a file on Windows; other hosts retain the existing five-worker and in-file concurrency defaults. The configured snapshot bound now controls `maxWorkers` as well as `maxConcurrency`, matching its documented claim. Full app loader probes use platform-aware subprocess deadlines, and optional OpenCode rows remain disabled until the launcher validates the runtime and opts in.

Snapshot ACP servers also stop forcing `process.exit(0)` immediately after their Cordis tree disposes. They set the successful exit code and let Node drain native callbacks and async handles naturally. This closes the remaining Windows race where a second sequential built-mode image request or persistent PowerShell scenario could reach libuv while a native handle was already closing.

The persistent PowerShell wrapper checks the console cursor before its completion marker and closes only an unterminated output row. Commands that use `Console.Out.Write` without a newline can otherwise make ConPTY redraw that row when PowerShell returns to pipeline output, and a line-oriented capture may retain the same visible text twice. Commands that already ended their own row keep their original newline contract. The plain-Node external-consumer smoke also uses directory junctions on Windows, so its published-package resolution contract runs without Developer Mode or elevation.

The comprehensive local `check:all` graph lets the native Windows unit inventory settle before starting sibling gates. The ordering uses a soft `after` edge rather than a success dependency, so a unit failure does not hide diagnostics from build, snapshot, hygiene, or documentation checks. Other platforms keep the parallel aggregate because their process substrate does not exhibit the Windows handle and subprocess starvation failure.

## Alternatives considered

**Skip all process-backed or snapshot tests on Windows.** Rejected because PowerShell, Windows paths, junction cleanup, and the shipped Leon composition are product surfaces that require native coverage.

**Increase every timeout without limiting concurrency.** Rejected because the libuv shutdown assertion is a concurrency collision, not merely a slow operation, and unlimited forks can continue to starve otherwise healthy children.

**Require Developer Mode or administrator symlink privileges.** Rejected because the intended installer and contributor experience must work on an ordinary Windows account; junctions exercise directory-link behavior without broadening host privileges.

**Normalize every backslash globally.** Rejected because model-authored commands, regular expressions, and unrelated text must remain regression-visible. Canonicalization stays limited to recognized generated paths.

## Consequences

The native Windows checkout can run the complete unit inventory and assembled Leon snapshots without treating missing POSIX capabilities as product failures. Platform-specific skips are narrow and explicit, while Linux and macOS retain the stronger symlink and Bash contracts. Windows gates take longer because subprocess-heavy ACP scenarios settle serially within their file, but their results are deterministic and no optional executor can prevent the base assistant from starting.
