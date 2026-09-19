# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh doctor` | Inspect local Leon readiness without changing files, services, credentials, or network configuration. |
| `dsh backup [file]` | Plan or create an encrypted offline package of Leon's authoritative state. |
| `dsh restore <file>` | Verify a package, or restore it into a new Harness home. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

New Leon sessions use `E:/computador` as their Windows workspace root. `$LEON_DEFAULT_WORKSPACE` lets the installer or operator select another directory; [`resolveDefaultWorkspace()`](../../packages/util/home-paths/README.md) owns the complete precedence and non-Windows behavior. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## Diagnosis

`dsh doctor` checks Node, PowerShell on Windows, the Harness home, installed profile, workspace, built launcher and Web port. It reads `agent-default-model` and `llm-pi-ai.providers` from `$DSH_HOME/settings.yaml`, checking the selected local llama.cpp route through `/health` and `/v1/models`, or Ollama through `/api/version` and `/api/tags`; it does not require a fixed 9B model. External endpoints are rejected; FreeLLMAPI and Gemini are not queried. Custom profiles that override `settings.path` or assemble dynamic configuration are outside this diagnosis. These read-only path probes and bounded GET requests do not initialize profiles, modify state, start services, read credential values or perform inference. Warnings keep exit status 0; installation failures or unrelated services on expected endpoints exit 1. Use `--profile <name>`, `--port <port>` or `--json`; see the [CLI behavior reference](reference/README.md#diagnosis).

## Collective laboratory

`dsh collective --dry-run` prints an illustrative plan with no sessions, agents, permissions, tests or memory, even when runtime flags are present. `--json` marks the preview `executed: false` and `persisted: false`. Without an explicit runtime, execution reports `COLLECTIVE_RUNTIME_UNAVAILABLE` and exits 2 without loading a profile.

Opt-in execution requires all five options: `--runtime <absolute.js>` (also `.mjs`), `--config <absolute.yml>` (also `.yaml`), `--workspace <absolute-directory>`, `--action run|resume|status|stop`, and `--scenario import-idempotency`. Files and the workspace must exist locally and not themselves be symbolic links. Arbitrary mission text is rejected; this bridge is not a general-purpose task executor. It invokes the selected JavaScript entry with the current Node executable and arguments `[action, workspace, config]`, without a shell, and forwards standard streams and the child's exit code without interpreting success. SIGINT/SIGTERM are forwarded; the bridge waits for the child to close and reports 130/143. Durable STOP semantics belong to the runtime's `stop` action, not to process interruption.

Only OS path/temp variables and a fixed local token placeholder reach the child; ambient credentials, Node options, provider settings and Harness home overrides do not. The operator must trust the runtime and composition: they execute local code, so this is not an OS sandbox or an authentication mechanism. The release CLI has no experimental package dependency, does not compile or install a runtime, and does not enable the laboratory in the normal profile. `--json` controls preview and launcher validation errors; delegated output remains the runtime's own format.

## Encrypted recovery

`dsh backup --dry-run` inventories and hashes the state that a package would contain without asking for a password or writing a file. After every Leon Web and headless process is stopped, `dsh backup --confirm-stopped` creates an authenticated `.leon-backup` package under `<workspace>/Backups/Leon` by default. A destination path may be supplied as the positional argument.

The encrypted payload contains durable sessions, accepted and candidate memories, workspace registrations, feedback and recovery state, original attachment objects, settings/personality, user instructions, skills, presets, and profile manifests/patches. The managed credential store and named `.env`/`.npmrc`/key files, the anonymous telemetry id, derived caches, profile dependencies, workspace contents, repositories, executables, and model weights are excluded. Sessions and other user-authored files can still contain secrets that were pasted into them, so encryption is the confidentiality boundary. The encrypted manifest records the original workspace reference and a best-effort local Ollama model inventory so an installer can reconstruct them separately.

`dsh restore <file>` decrypts and verifies every authenticated record without changing the filesystem. Add `--apply --confirm-stopped` only after that preview to publish the state into a target Harness home that does not exist; v1 never merges with or replaces an installation. The source Leon version must match the restoring launcher, and credentials must be registered again. Passwords are read through a hidden terminal prompt; `--passphrase-stdin` exists only for a trusted installer or automation pipe and never accepts the password in argv or an environment variable. See the [recovery contract](reference/README.md#encrypted-recovery) for scope and limitations.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.

The public `@deepseek-ai/dsh/desktop` entry starts the same `web` profile for the private Windows Electron shell. It is an in-process host adapter, not a second UI or a second protocol implementation; the shell owns the native window and calls the returned shutdown controller before exit.
