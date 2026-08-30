# `dsh` CLI behavior reference

English | [中文](README.zh.md)

This reference defines the profile, web-alias, diagnosis, encrypted-recovery, plugin-management, and config-dump command modes. Argv is parsed once through [`src/args.ts`](../src/args.ts), and [`src/bin.ts`](../src/bin.ts) dynamically imports only the selected runner.

## Profile boot

`dsh --profile <name>` boots the profile at `$DSH_HOME/profiles/<name>`. The effective tree is composed over an empty root by applying, in order: each bundle patch named in the profile manifest's `dsh.profile.bundles` list, the profile's own `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml` (machine-local preferences shared by every profile, so it outranks the per-profile layer), and each `--patch <path>` overlay in argv order. Later layers win per row; a patch replaces the targeted row's complete `config` value rather than deep-merging keys, and may insert new rows. A parse, schema, resolution, or plugin boot failure is reported and exits nonzero. SIGINT and SIGTERM dispose the mounted root before exit.

Bundle names resolve from the dsh installation first, then from the profile directory. In-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`) therefore always come from the same installation as the running `dsh`; out-of-tree bundles come from the profile's pnpm-managed `node_modules`. A bare plugin `name` in any patch row resolves through the profile directory's Node parent-walk, which reaches the maintained installation fallback `$DSH_HOME/profiles/node_modules` (one symlink per package the installation's app and bundles depend on, healed on every launch).

The `web` and `headless` profiles auto-initialize from shipped templates on first use (`web`: base + web-app; `headless`: base + headless). Any other missing profile fails loud with a hint to run `dsh plugin --profile <name> add <package>`.

### App arguments

The launcher's flags come first and end at the first token it does not recognize; everything from there on is handed to the booted profile verbatim through `ctx.cmdlineArgs`, where any injected app plugin may parse it ([`dsh-cmdline`](../../../packages/boot/cmdline/README.md)). `dsh --profile web --port 8080` therefore reaches the web app's `--port`, `dsh --profile web --help` prints that app's help and boots nothing, and `dsh --help` (no profile to hand it to) prints the launcher's own. `-V`/`--version` prints the launcher's version when it appears before the app-argument boundary.

A composition mounts once. An ordinary plugin injects `cmdlineArgs`, parses this app's arguments, and provides what it resolved as a service; each row configured from flags injects that service, and Loader waits for it before evaluating the row's config (`port: !!js ctx.webStartup.port ?? 3080`). A flag therefore beats the value written beside it. This precedence requires the row to retain that expression; a user patch that replaces the whole `config` with literals removes the runtime read. Help and rejected arguments request exit — nonzero for a rejection, 0 for help — without activating rows that depend on the provider's service. A live `cordis.patch.yml` edit re-evaluates expressions against services that are still up, so it cannot reset a served port.

Launcher flags must come before app arguments, and the launcher's parser consumes one `--`: an app argument that must arrive as a literal `--` needs `-- --`. A first app argument equal to `web` or `plugin` selects that subcommand instead. `ctx.cmdlineArgs.get()` is a shared immutable read: multiple plugins may parse the same snapshot, while a profile with no reader ignores its app arguments.

The shipped apps own these command lines:

| Profile | Arguments |
|---|---|
| `web` | `--host`, `--port`, repeatable `--trusted-host`, `--no-open` |
| `headless` | the task text, as the positional argument |

A one-shot task (`dsh --profile headless "run the tests"`) creates one fresh persisted Agent through the core registry, submits the task, waits for quiescence, and flushes the Session before deriving the last non-empty assistant text and final `turn/end` reason from its durable interval. It prints the text on stdout and exits 0 for `completed`, else 1. An invocation with no task is a usage error from that app. The shipped headless profile mounts no ApiProxy, Host, HTTP server, Web runtime, or browser client; a successful run writes nothing to stderr and opens no listening port.

Inspect the composed tree without booting it:

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` prints only the bundle layers; `--dump-config` adds the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, and `--patch` overlays. Both print comments naming the file that supplied each row and every overlay that changed it; `!!js` expressions remain unevaluated, and unmatched patch targets are reported on stderr. A dump never runs app command-line providers, so it shows the composed tree before any app argument is resolved and rejects an invocation that carries app arguments.

## Diagnosis

`dsh doctor` is a boot-free, read-only launcher mode. It checks the current Node version against `^22.19 || >=24`, requires `pwsh` on Windows, inspects read/write access to the resolved Harness home and default workspace, verifies the selected profile's `package.json` and `cordis.patch.yml` when the profile exists, and detects the built `lib/bin.js`. A missing home, uninitialized profile, stopped Web or FreeLLMAPI process, missing build artifact during source execution, unavailable Ollama endpoint, or a FreeLLMAPI router with no ready upstream is a warning; an unsupported runtime, inaccessible workspace, incomplete installed profile, missing Windows PowerShell, or a different service answering on an expected endpoint is a failure.

The Ollama probe sends only `GET <OLLAMA_HOST-or-loopback>/api/tags`, caps the retained response prefix, and reports whether `qwen3.5:9b` is present for Leon Automatic. Manually selectable Ornith and Qwen 3.8 models do not affect automatic-route readiness. The FreeLLMAPI probe sends `GET http://127.0.0.1:31415/readyz`, validates the service-shaped response, and reports its ready-upstream count. The Web probe sends one bounded GET to `http://127.0.0.1:<port>/` and identifies Leon from the returned page title or The Lions branding. None of these requests sends prompts or credentials. The command never creates a path, initializes a profile, starts or stops a service, changes a port, or attempts a repair.

```sh
dsh doctor
dsh doctor --profile headless --port 4175
dsh doctor --json
```

The human report is PT-BR. `--json` emits one `schemaVersion: 1` document containing product/version/time, an overall `ok`/`warning`/`failed` status, and sanitized checks with stable ids, labels, summaries, and optional details. Credential values and file contents are absent. Warnings exit 0 so a stopped optional service does not break installer orchestration; any failed check exits 1.

## Encrypted recovery

Recovery is a boot-free launcher mode. `dsh backup --dry-run [--json]` enumerates and SHA-256-hashes the authoritative allowlist without creating a directory, asking for a password, or initializing a profile. A real backup requires `--confirm-stopped`; it additionally refuses any service answering on `127.0.0.1:3080`. This flag is an operator assertion, not a cross-process lock: v1 cannot detect a headless process or Web instance on another port, so every Leon process must be stopped before it is supplied.

```sh
dsh backup --dry-run
dsh backup --confirm-stopped
dsh backup E:/offline/leon.leon-backup --confirm-stopped
dsh restore E:/offline/leon.leon-backup
dsh restore E:/offline/leon.leon-backup --target E:/restored/.dsh --apply --confirm-stopped
```

The default package path is `<resolveDefaultWorkspace()>/Backups/Leon/leon-<UTC>.leon-backup`. An existing destination is never overwritten, and a package may not reside inside the source Harness home, including through a resolved parent link. The writer calculates a first hash plan, streams each exact planned file into a private same-parent staging directory, recomputes its hash while encrypting, verifies that the allowlisted path set did not change, syncs the file, and publishes it through an exclusive hard link. A changed, truncated, or appended file, or a new/removed allowlisted path, aborts publication. The destination filesystem must support hard links (for example NTFS, APFS, or ext4); v1 has no less-safe overwrite-prone fallback for FAT/exFAT. The launcher reopens and authenticates the published package before reporting it as created. A cleanup or directory-sync problem after publication is returned as a warning because the package already exists.

The allowlist contains `settings.yaml`, the home patch and global `AGENTS.md`; `session.jsonl`/`session.jsonl.zstd` artifacts; original content-addressed attachment objects; workspace, memory, feedback, procedure-learning, and failure-recovery storage domains; user skills, presets, and durable spills; and each profile's manifest, patch, workspace file, and lockfile. It excludes `.credentials.yaml`, named `.env`, `.npmrc`, credential, key, and certificate files, the anonymous telemetry id, temporary session writes, `session_projcache`, derived request images, `node_modules`, browser/provider caches, workspace contents and repositories, binaries, and model weights. This is a filename and scope policy, not content redaction: sessions, settings, instructions, skills, and other authored files can contain secrets pasted by the user. The whole package therefore remains encrypted. The encrypted manifest records the workspace path and local Ollama names only as reconstruction hints.

The custom `LEONBK1` container uses scrypt (`N=131072`, `r=8`, `p=1`, random 128-bit salt) to derive an AES-256-GCM key. The manifest and every file are independently authenticated under unique random-prefix nonces and path/size/hash/mode AAD. There is no compression or general archive extractor. Passwords have a minimum of 16 Unicode code points and come from a non-echoing TTY prompt; backup confirms the prompt. `--passphrase-stdin` reads one bounded line only from redirected stdin for trusted installer automation. No password option or environment variable exists.

`dsh restore <file>` is verification-only: it decrypts the manifest, rejects unsupported versions, a package claiming to contain the managed credential store, unsafe/non-allowlisted paths, Windows reserved names and ADS, duplicates, Unicode/case collisions, file/directory conflicts, oversized counts/payloads, truncation, trailing bytes, GCM failure, or SHA/size mismatch, then streams and authenticates every payload without writing output. `--apply` also requires `--confirm-stopped`, an exact Leon version match, and a target that does not exist. After authenticating the whole package, it acquires an exclusive sibling restore lock, extracts each authenticated regular file through a disposable partial file in a random private sibling staging directory, syncs it, rechecks the target, and publishes the complete directory by rename. A stale lock fails closed and must be inspected instead of being removed automatically. The lock serializes cooperating Leon restores; v1 does not claim protection from a hostile non-cooperating process racing filesystem changes on every supported operating system. Restore never follows or recreates a link, loads a profile, evaluates `!!js`, installs dependencies, starts Leon, merges state, or intentionally replaces an existing home.

After restore, re-register credentials, reinstall profile dependencies and the manifest's model names, verify every referenced workspace/project backup separately, run `dsh doctor`, then start Leon and inspect session/memory/attachment counts. The package protects its contents cryptographically, but Node permission bits do not establish a private Windows DACL; the future Windows installer remains responsible for applying and verifying the destination ACL. Workspace/project backup, external `.leon` integration databases, active-process locking, current-home replacement with rollback, and durable temporary spill migration are outside v1.

## Plugin management

`dsh plugin --profile <name> <args...>` initializes the profile when missing (shipped template, or `@deepseek-ai/dsh-base` alone for other names), then forwards `<args...>` to `pnpm` with the profile directory as working directory — `add`, `remove`, `why`, `update`, and every other pnpm verb work unchanged; pnpm must be on PATH. Relative path specs (`.`, `../plugin`, and their `file:`/`link:` forms) are anchored to the invoking directory first, so `add .` from a plugin checkout installs that checkout, not the profile. After every successful run, `dsh.profile.bundles` is reconciled against the installed state: each dependency resolving to a package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` joins the layer stack (so an `update` that gains the declaration activates it), a bundle-less dependency stays plain with a one-time warning, and a removed dependency leaves the stack.

The Codex and Claude Code subagent providers are separate optional Bundles. Add either package, both in one command, or remove either package independently:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
```

The successful pnpm operation changes the Profile manifest and Bundle list on disk; a running Profile keeps the Bundle set from its current start. Restart that Profile after adding, removing, or updating a Bundle. This startup boundary applies to Bundle membership, while ordinary edits to the Profile or home `cordis.patch.yml` take effect through hot reload. On the next start, each installed Bundle registers only its dormant Host provider; a copied Preset must separately enable the matching tool row for new Agents. The [Codex provider README](../../../packages/subagent/subagent-codex/README.md) and [Claude Code provider README](../../../packages/subagent/subagent-claude-code/README.md) own executable, authentication, payload, and failure details; the [base Bundle reference](../../../packages/bundle/base/README.md) owns the default dependency closure.

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git-hosted plugins that ship sources build during install through their `prepare` script, which pnpm ≥10 blocks until the consumer allows it: the first `add` fails with pnpm's `allowBuilds` hint (and a dsh pointer at the profile's `pnpm-workspace.yaml`); copy the printed key there and re-run. Installing a built tarball or a local checkout needs no allowance.

## Web alias

`dsh web` is a hardcoded alias for `--profile web`; the flags after it belong to the web app, whose ordinary bundle provider parses them. `--host` and `--port` override the composed values of the rows that carry them, repeatable `--trusted-host` contributes invocation authorities through `ctx.webRuntime.trustedHosts` (a deployment expression concatenates its own authorities), and `--no-open` disables the default-browser handoff for this invocation. The client-plugin HMR receiver is always mounted and stays idle until a separate `pnpm run dev:web` watcher rebuilds client bundles.

```sh
dsh web
dsh web --no-open
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
dsh web --help
```

The production Web runner needs built package and frontend artifacts (`pnpm run build`). It serves `http://127.0.0.1:3080` by default and, for a local launch, opens that canonical host URL only after the complete Loader tree settles. A non-empty inherited `SSH_CONNECTION` or `SSH_TTY` suppresses the browser handoff because the SSH client or editor owns the local forwarded address; the host URL is still printed. The CLI intentionally does not support `--host 0.0.0.0` yet and exits with a usage error. Immediately before a local handoff it prints `dsh web: opening the default browser; pass --no-open to disable`; if the operating-system handoff fails, a diagnostic on stderr states the reason, leaves the server running, and names the URL for manual use. `--trusted-host` adds named authorities accepted by the `/api` browser-trust fence.

Process shutdown gives the plugin tree up to five seconds to dispose. The first `SIGINT`/`SIGTERM` starts that graceful drain — `SIGTERM` is a supervisor's ordinary stop request and exits 0 on every surface, `SIGINT` reports 130; a second signal forces immediate exit. If one-shot normal completion is already stuck in disposal, the first `Ctrl+C` is the escalation and exits immediately instead of being swallowed.

All modes use the root from `resolveDefaultWorkspace()`: explicit deployment configuration, `$LEON_DEFAULT_WORKSPACE`, `$DSH_DEFAULT_WORKSPACE`, `$DSH_CWD`, then `E:/computador` on Windows or the invoking directory on other platforms. They load applicable `AGENTS.md` or `CLAUDE.md` instructions with a 65,536-byte render budget and use an in-memory SQLite session content index. Every profile boot watches valid edits of both `cordis.patch.yml` layers (profile and home) and reapplies them transactionally; a one-shot surface exits through its bounded shutdown, which disposes the watchers.

New sessions default to the `workspace-write` permission preset. Bash and filesystem mutations are restricted to the session workspace and platform temporary roots; reads and network access are not confined, while process visibility depends on the selected sandbox backend — bwrap runs commands in a private PID namespace that hides host processes, and Landlock and Seatbelt leave host process visibility unchanged. `DSH_PERMISSION_MODE` changes the process fallback. Stored General-settings permissions affect later Web sessions, not an already-open one.

`DSH_TOOLS_MODE` selects `native`, `code`, or `both` for the process; another value fails at boot. The shipped `minimal` agent preset keeps that deployment presentation, fixes the complete system prompt to `You are a helpful software engineer assistant.`, and composes only persistent `bash` plus `str_replace_editor`. Select 极简模式 when creating a Web session; every other prompt section and model-facing plugin remains absent from that agent while the shared browser, workspace, persistence, sandbox, and permission host stays in place.

## Shared deployment behavior

The base bundle mounts the native DeepSeek adapter, settings and credential providers, stable `web_search`, and disabled session telemetry. Provider credentials resolve from the inherited environment, `$DSH_HOME/.credentials.yaml`, the invoking directory's `.env`, then `$DSH_HOME/.env`; the managed document is never materialized into `process.env`, while both `.env` files are ordinary launch environment layers. Search uses `DEEPSEEK_API_KEY` and accepts `DEEPSEEK_SEARCH_BASE_URL`; `web_fetch` is disabled unless a patch layer inserts a provider and enables it.

Session telemetry stays local by default. `DSH_TELEMETRY_MODE=FULL` streams every projected session event as OTLP/HTTP logs, while `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` uploads a session-log suffix only when feedback is recorded. `DSH_TELEMETRY_OTLP_URL` selects another collector, and any non-empty `DSH_TELEMETRY_DISABLED` remains an authoritative hard opt-out. The shipped base has no telemetry redaction rule, so explicitly enabled exports can contain message text, tool arguments and results, and workspace paths; the [default-off Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md) owns that deployment decision.

Install external plugin bundles through `dsh plugin --profile <name> add <package-or-git-spec>`. The installed package owns its dependencies and contributes its declared `cordis.patch.yml` layer. The CLI also ships `@deepseek-ai/dsh-mcp-client` as a dependency for patch layers, but no MCP server is enabled by default because each server command is trusted executable code outside the agent sandbox.

## Source execution

From the repository root, run `pnpm run build` separately after a fresh checkout and whenever artifacts need updating, then use `pnpm dsh <args...>`. The `package.json` script launches `apps/cli/src/bin.ts` with `node --import tsx/esm` without building and forwards every argument. Missing Typert host artifacts fail profile boot through module-resolution errors without a build instruction. Once those host artifacts exist, missing frontend or client-plugin bundles fail at startup with an instruction to run `pnpm run build`. The launcher does not check freshness, so existing stale bundles can run older browser code until rebuilt. The process inherits the launch environment; set `NODE_USE_ENV_PROXY=1` when a supporting Node version must honor `HTTP_PROXY` and `HTTPS_PROXY`. The installed form launches the built `apps/cli/lib/bin.js` without rebuilding the repository.
