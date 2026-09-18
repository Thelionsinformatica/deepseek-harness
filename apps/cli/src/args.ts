/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 *
 * `web` is a hardcoded alias for `--profile web`; `plugin` manages a profile's
 * plugin dependencies by forwarding to pnpm.
 * The default/profile launchers, plugin management, read-only doctor, and
 * offline recovery commands share this single parsing contract.
 *
 * @module @deepseek-ai/dsh/args
 */

import { Command, CommanderError, InvalidArgumentError } from 'commander'

/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
  args: string[]
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/** Run the read-only Leon installation and runtime diagnosis. */
interface DoctorInvocation {
  mode: 'doctor'
  /** Profile whose installed files are inspected without initializing it. */
  profile: string
  /** Expected local Web port. */
  port: number
  /** Emit one machine-readable JSON document instead of the human report. */
  json: boolean
}

/** Create an encrypted, offline Leon state package. */
interface BackupInvocation {
  mode: 'backup'
  /** Destination package; omission selects the workspace Backups/Leon folder. */
  output?: string
  /** Inventory and hash state without asking for a passphrase or writing a package. */
  dryRun: boolean
  json: boolean
  /** Explicit operator assertion required before a real snapshot. */
  confirmStopped: boolean
  /** Read one passphrase line from redirected stdin instead of a hidden TTY prompt. */
  passphraseStdin: boolean
}

/** Verify or restore one encrypted Leon state package. */
interface RestoreInvocation {
  mode: 'restore'
  archive: string
  /** Destination Harness home; omission uses the configured DSH_HOME. */
  target?: string
  /** Publish into a destination that must not exist; omission only verifies. */
  apply: boolean
  json: boolean
  /** Explicit operator assertion required before publication. */
  confirmStopped: boolean
  /** Read one passphrase line from redirected stdin instead of a hidden TTY prompt. */
  passphraseStdin: boolean
}

/** Preview a mission or explicitly delegate the bounded local laboratory scenario. */
export interface CollectiveInvocation {
  mode: 'collective'
  mission?: string
  dryRun: boolean
  json: boolean
  runtime?: string
  config?: string
  workspace?: string
  action?: string
  scenario?: string
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation
  | DoctorInvocation | BackupInvocation | RestoreInvocation | CollectiveInvocation

/** Launcher flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  dsh --profile web                          boot the web profile (same as: dsh web)
  dsh --profile headless "run the tests"     answer one task, print the result, and exit
  dsh doctor                                 inspect Leon's local runtime without changing it
  dsh backup --dry-run                       inventory the state that an encrypted backup would carry
  dsh backup --confirm-stopped               create an encrypted state package after Leon is stopped
  dsh restore <file>                         decrypt and verify a package without changing DSH_HOME
  dsh restore <file> --apply --confirm-stopped  restore only into a destination that does not exist
  dsh --profile tui --patch ./extra.yml      boot a custom profile with one extra overlay
  dsh --profile tui --resume <session>       arguments after the launcher flags reach the app
  dsh --profile web --help                   the web app's own flags and help
  dsh plugin --profile tui add <package>     install a plugin into the tui profile
`

/** Parse one TCP port for the doctor command. */
function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new InvalidArgumentError('expected an integer from 1 to 65535')
  }
  return port
}

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): DshInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('dsh')
    .version(version, '-V, --version', 'output the version number')
    .description('Leon: boot a provider-neutral profile — an ordered stack of plugin-bundle patch layers under your own overrides.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. `dsh -h` with no profile still prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: dsh --profile <name> --help)')
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `dsh -h` (no profile to hand it to) must print.
      if (options.profile === undefined) {
        if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
        program.error('error: --profile <name> is required')
      }
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  const doctor = program.command('doctor').description('inspect Leon runtime readiness without changing files, services, credentials, or network configuration')
  doctor
    .option('--profile <name>', 'installed profile to inspect', 'web')
    .option('--port <port>', 'expected local Leon Web port', parsePort, 3080)
    .option('--json', 'emit a machine-readable JSON report')
    .action((options: { profile: string; port: number; json?: boolean }) => {
      rejectParentOptions('doctor')
      if (options.profile === '') program.error('error: --profile needs a name')
      resolved = {
        mode: 'doctor',
        profile: options.profile,
        port: options.port,
        json: options.json === true,
      }
    })

  const backup = program.command('backup').description('create an encrypted offline package of Leon state (managed credential store, workspaces, and model weights excluded)')
  backup
    .argument('[output]', 'destination .leon-backup file; defaults below the Leon workspace')
    .option('--dry-run', 'inventory and hash state without writing a package')
    .option('--json', 'emit a machine-readable JSON report')
    .option('--confirm-stopped', 'assert that every Leon Web/headless process has been stopped')
    .option('--passphrase-stdin', 'read one passphrase line from redirected stdin (automation only)')
    .action((output: string | undefined, options: {
      dryRun?: boolean
      json?: boolean
      confirmStopped?: boolean
      passphraseStdin?: boolean
    }) => {
      rejectParentOptions('backup')
      if (output === '') program.error('error: backup output cannot be empty')
      if (options.dryRun === true && options.passphraseStdin === true) {
        program.error('error: backup --dry-run does not read a passphrase')
      }
      resolved = {
        mode: 'backup',
        ...output === undefined ? {} : { output },
        dryRun: options.dryRun === true,
        json: options.json === true,
        confirmStopped: options.confirmStopped === true,
        passphraseStdin: options.passphraseStdin === true,
      }
    })

  const restore = program.command('restore').description('verify an encrypted Leon package, or restore it into a destination that does not exist')
  restore
    .argument('<archive>', 'encrypted .leon-backup file')
    .option('--target <path>', 'new Harness home that receives a verified restore')
    .option('--apply', 'publish the restore; without this flag the command is read-only')
    .option('--json', 'emit a machine-readable JSON report')
    .option('--confirm-stopped', 'assert that every Leon Web/headless process has been stopped')
    .option('--passphrase-stdin', 'read one passphrase line from redirected stdin (automation only)')
    .action((archive: string, options: {
      target?: string
      apply?: boolean
      json?: boolean
      confirmStopped?: boolean
      passphraseStdin?: boolean
    }) => {
      rejectParentOptions('restore')
      if (archive === '') program.error('error: restore archive cannot be empty')
      if (options.target === '') program.error('error: restore --target cannot be empty')
      resolved = {
        mode: 'restore',
        archive,
        ...options.target === undefined ? {} : { target: options.target },
        apply: options.apply === true,
        json: options.json === true,
        confirmStopped: options.confirmStopped === true,
        passphraseStdin: options.passphraseStdin === true,
      }
    })

  const collective = program.command('collective').description('preview a mission or explicitly launch an isolated collective laboratory')
  collective
    .argument('[mission...]', 'the mission statement or objective for the collective team')
    .option('--dry-run', 'print an illustrative plan without executing any runtime')
    .option('--json', 'emit JSON for the preview or launcher errors; runtime output is forwarded unchanged')
    .option('--runtime <file>', 'absolute path to a trusted, compiled laboratory .js or .mjs entry')
    .option('--config <file>', 'absolute path to the explicit laboratory .yml or .yaml composition')
    .option('--workspace <directory>', 'absolute path to an existing isolated laboratory workspace')
    .option('--action <action>', 'laboratory operation: run, resume, status or stop')
    .option('--scenario <scenario>', 'bounded scenario: import-idempotency')
    .action((missionParts: string[], options: {
      dryRun?: boolean
      json?: boolean
      runtime?: string
      config?: string
      workspace?: string
      action?: string
      scenario?: string
    }) => {
      rejectParentOptions('collective')
      resolved = {
        mode: 'collective',
        ...missionParts.length > 0 ? { mission: missionParts.join(' ') } : {},
        dryRun: options.dryRun === true,
        json: options.json === true,
        ...options.runtime === undefined ? {} : { runtime: options.runtime },
        ...options.config === undefined ? {} : { config: options.config },
        ...options.workspace === undefined ? {} : { workspace: options.workspace },
        ...options.action === undefined ? {} : { action: options.action },
        ...options.scenario === undefined ? {} : { scenario: options.scenario },
      }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('dsh: no invocation resolved')
  return resolved
}
