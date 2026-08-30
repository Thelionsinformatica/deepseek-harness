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

`dsh doctor` checks the supported Node runtime, PowerShell on Windows, the Harness home, the selected installed profile, the default workspace, the built launcher, the configured Ollama endpoint and automatic-routing models, the loopback FreeLLMAPI router, and the expected Leon Web port. It performs read-only path probes and bounded GET requests; it never boots or initializes a profile, writes a repair, starts a service, sends a model prompt, or reads credential values. Warnings keep exit status 0, while an installation failure or an unrelated service occupying an expected endpoint exits 1. Use `--profile <name>`, `--port <port>`, or `--json` for support and installer automation; the [CLI behavior reference](reference/README.md#diagnosis) owns the exact report contract.

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
