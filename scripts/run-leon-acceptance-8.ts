/** Run LEON-ACC-008 through two real local headless Leon runtimes. */

import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import {
  captureLeonAcc008SourceDigests,
  createLeonAcc008Fixture,
  evaluateLeonAcc008,
  LEON_ACCEPTANCE_8_SCHEMA_VERSION,
  LEON_ACC_008_INJECTED_CURRENCY_SOURCE,
  LEON_ACC_008_LIMITS,
  leonAcc008LoopbackUrl,
  summarizeLeonAcc008Session,
  type LeonAcc008OracleRun,
  type LeonAcc008Report,
  type LeonAcc008SessionSummary,
} from './leon-acceptance-8-model.ts'

const root = resolve(import.meta.dirname, '..')
const DEFAULT_OUTPUT = '.artifacts/leon-acceptance-8/latest.json'
const DEFAULT_IMPLEMENTATION_MODEL = 'qwen3.5:9b'
const DEFAULT_RECOVERY_MODEL = 'ornith-1.5:9b'
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const EXTERNAL_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'FREELLMAPI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'NVIDIA_API_KEY',
  'OMNIROUTE_API_KEY',
  'OPENAI_API_KEY',
] as const

interface Options {
  readonly implementationModel: string
  readonly recoveryModel: string
  readonly ollamaUrl: URL
  readonly outputPath: string
}

interface LocalModelIdentity {
  readonly id: string
  readonly digest: string
}

interface HeadlessRun {
  readonly summary: LeonAcc008SessionSummary
}

interface BenchmarkArtifact extends LeonAcc008Report {
  readonly generatedAt: string
  readonly node: string
  readonly platform: NodeJS.Platform
  readonly architecture: string
  readonly localOnly: true
  readonly ollamaOrigin: string
  readonly models: readonly LocalModelIdentity[]
  readonly externalCredentialVariablesPresent: readonly string[]
  readonly temporaryFixtureDeleted: true
}

interface FailedArtifact {
  readonly schemaVersion: typeof LEON_ACCEPTANCE_8_SCHEMA_VERSION
  readonly benchmark: 'LEON-ACC-008-long-autonomous-v1'
  readonly generatedAt: string
  readonly node: string
  readonly platform: NodeJS.Platform
  readonly architecture: string
  readonly status: 'failed'
  readonly failures: readonly string[]
  readonly localOnly: true
  readonly ollamaOrigin: string
  readonly externalCredentialVariablesPresent: readonly string[]
  readonly temporaryFixtureDeleted: true
}

class BenchmarkFailure extends Error {
  public constructor(public readonly code: string) {
    super(code)
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))

async function main(args: readonly string[]): Promise<number> {
  const options = parseArgs(args)
  const outputPath = isAbsolute(options.outputPath) ? options.outputPath : resolve(root, options.outputPath)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leon-acceptance-8-'))
  let artifact: BenchmarkArtifact | FailedArtifact
  try {
    artifact = await runBenchmark(options, temporaryRoot)
  } catch (error: unknown) {
    artifact = failureArtifact(options, failureCode(error))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  await writeArtifact(outputPath, artifact)
  printSummary(artifact, outputPath)
  return artifact.status === 'passed' ? 0 : 1
}

async function runBenchmark(options: Options, temporaryRoot: string): Promise<BenchmarkArtifact> {
  const cli = join(root, 'apps', 'cli', 'lib', 'bin.js')
  await requireFile(cli, 'BUILT_CLI_REQUIRED')
  const fixtureRoot = join(temporaryRoot, 'fixture')
  const oracleRoot = join(temporaryRoot, 'host-oracle')
  const implementationHome = join(temporaryRoot, 'implementation-home')
  const recoveryHome = join(temporaryRoot, 'recovery-home')
  await Promise.all([
    mkdir(fixtureRoot, { recursive: true }),
    mkdir(oracleRoot, { recursive: true }),
    mkdir(implementationHome, { recursive: true }),
    mkdir(recoveryHome, { recursive: true }),
  ])
  const baseline = await createLeonAcc008Fixture(fixtureRoot)
  const oraclePath = join(oracleRoot, 'hidden-order-summary.test.mjs')
  await writeFile(oraclePath, hiddenOracleSource(fixtureRoot), 'utf8')
  const models = await requireLocalModels(options)

  const implementation = await runHeadless({
    cli,
    dshHome: implementationHome,
    fixtureRoot,
    model: options.implementationModel,
    ollamaUrl: options.ollamaUrl,
    stage: 'implementation',
    task: implementationTask(),
  })
  const implementationDigests = await captureLeonAcc008SourceDigests(fixtureRoot)
  const implementationOracle = await runHiddenOracle('implementation', fixtureRoot, oraclePath)

  await writeFile(
    join(fixtureRoot, 'src', 'currency.mjs'),
    LEON_ACC_008_INJECTED_CURRENCY_SOURCE,
    'utf8',
  )
  const injectedDigests = await captureLeonAcc008SourceDigests(fixtureRoot)
  const injectedOracle = await runHiddenOracle('injected-regression', fixtureRoot, oraclePath)

  const recovery = await runHeadless({
    cli,
    dshHome: recoveryHome,
    fixtureRoot,
    model: options.recoveryModel,
    ollamaUrl: options.ollamaUrl,
    stage: 'recovery',
    task: recoveryTask(),
  })
  const recoveryOracle = await runHiddenOracle('recovery', fixtureRoot, oraclePath)
  const report = await evaluateLeonAcc008(fixtureRoot, baseline, {
    implementationDigests,
    injectedDigests,
    sessions: [implementation.summary, recovery.summary],
    oracleRuns: [implementationOracle, injectedOracle, recoveryOracle],
    implementationModel: options.implementationModel,
    recoveryModel: options.recoveryModel,
  })
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    localOnly: true,
    ollamaOrigin: options.ollamaUrl.origin,
    models,
    externalCredentialVariablesPresent: [],
    temporaryFixtureDeleted: true,
    ...report,
  }
}

async function runHeadless(options: {
  readonly cli: string
  readonly dshHome: string
  readonly fixtureRoot: string
  readonly model: string
  readonly ollamaUrl: URL
  readonly stage: LeonAcc008SessionSummary['stage']
  readonly task: string
}): Promise<HeadlessRun> {
  const overlay = join(options.dshHome, 'leon-acc-008.patch.yml')
  await writeFile(overlay, overlaySource(options.model, options.ollamaUrl), 'utf8')
  const environment = childEnvironment(options.dshHome, options.fixtureRoot)
  const started = performance.now()
  const result = await execa(process.execPath, [
    options.cli,
    '--profile',
    'headless',
    '--patch',
    overlay,
    options.task,
  ], {
    cwd: options.dshHome,
    env: environment,
    reject: false,
    timeout: LEON_ACC_008_LIMITS.maxDurationMs,
  })
  const durationMs = Math.round(performance.now() - started)
  const records = await readOnlySessionLog(options.dshHome)
  return {
    summary: summarizeLeonAcc008Session(
      records,
      options.stage,
      result.exitCode ?? 1,
      durationMs,
      result.stdout,
      options.fixtureRoot,
    ),
  }
}

async function runHiddenOracle(
  phase: LeonAcc008OracleRun['phase'],
  fixtureRoot: string,
  oraclePath: string,
): Promise<LeonAcc008OracleRun> {
  const started = performance.now()
  const result = await execa(process.execPath, ['--test', oraclePath], {
    cwd: fixtureRoot,
    env: hostOracleEnvironment(),
    reject: false,
    timeout: 30_000,
  })
  return {
    phase,
    exitCode: result.exitCode ?? 1,
    durationMs: Math.round(performance.now() - started),
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    sourceDigests: await captureLeonAcc008SourceDigests(fixtureRoot),
  }
}

async function requireLocalModels(options: Options): Promise<readonly [LocalModelIdentity, LocalModelIdentity]> {
  let response: Response
  try {
    response = await fetch(new URL('/api/tags', options.ollamaUrl), { signal: AbortSignal.timeout(5_000) })
  } catch {
    throw new BenchmarkFailure('OLLAMA_UNAVAILABLE')
  }
  if (!response.ok) throw new BenchmarkFailure('OLLAMA_UNAVAILABLE')
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.models)) throw new BenchmarkFailure('OLLAMA_INVALID_TAGS_RESPONSE')
  const available = new Map<string, string>()
  for (const item of body.models) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.digest !== 'string') continue
    available.set(item.name, item.digest)
  }
  const resolveModel = (id: string): LocalModelIdentity => {
    const digest = available.get(id)
    if (digest === undefined) throw new BenchmarkFailure(`LOCAL_MODEL_MISSING_${stableId(id)}`)
    return { id, digest }
  }
  return [resolveModel(options.implementationModel), resolveModel(options.recoveryModel)]
}

function overlaySource(model: string, ollamaUrl: URL): string {
  const quotedModel = JSON.stringify(model)
  const quotedBaseUrl = JSON.stringify(`${ollamaUrl.origin}/v1`)
  return `# Ephemeral local-only LEON-ACC-008 composition.
- id: agent-default-model
  config:
    provider: ollama
    model: ${quotedModel}

- id: llm-pi-ai
  config:
    providers:
      ollama:
        displayName: Ollama Local Acceptance
        api: openai-completions
        baseURL: ${quotedBaseUrl}
        retryPolicy:
          mode: normal
          maxRetries: 1
        headers:
          Authorization: Bearer ollama-local
        defaultContextWindow: 32768
        defaultMaxTokens: 8192
        defaultInput: [text]
        reasoning: off
        models:
          - id: ${quotedModel}
            name: ${quotedModel}
            contextWindow: 32768
            maxTokens: 8192
            input: [text]

- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
    packChunks: false

- id: approval
  config:
    policy: never

- id: permission
  config:
    defaultPreset: acceptance
    presets:
      acceptance:
        sandbox: workspace-write
        approval: never

- id: session-title-llm
  disabled: true
- id: settings
  disabled: true
- id: credentials
  disabled: true
- id: jobs
  disabled: true
- id: tool-jobs
  disabled: true
- id: skill
  disabled: true
- id: skill-filesystem
  disabled: true
- id: tool-skill
  disabled: true
- id: goal
  disabled: true
- id: goal-round-driver
  disabled: true
- id: command-goal
  disabled: true
- id: tool-goal
  disabled: true
- id: subagent
  disabled: true
- id: subagent-spawn-in-process
  disabled: true
- id: subagent-fork-in-process
  disabled: true
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: tool-subagent-report
  disabled: true
- id: tool-subagent-opencode
  disabled: true
- id: workflow-worker-thread
  disabled: true
- id: tool-workflow
  disabled: true
- id: tool-ralph
  disabled: true
- id: web
  disabled: true
- id: tool-web
  disabled: true
- id: code-runtime
  disabled: true
`
}

function implementationTask(): string {
  return `Complete the product task in TASK.md autonomously.

Requirements for this acceptance run:
- Make todo_write your first tool call and record at least five concrete implementation and verification steps.
- Inspect the task and existing implementation with filesystem tools, then implement the requirements across the source files that need changes.
- Use filesystem or structured edit tools for every read and mutation.
- The only shell command permitted is exactly: node --test
- Run that test command and fix every observed failure before concluding.
- Do not modify TASK.md, package.json, or anything under test/.
- Do not use network, browser, MCP, subagents, workflows, or background jobs.
- Conclude only after a successful test result is visible in this turn. State the evidence briefly; do not create a completion receipt file.`
}

function recoveryTask(): string {
  return `A verification regression has been detected in the current order-summary workspace. Diagnose and correct it autonomously.

Requirements for this acceptance run:
- Begin by running exactly node --test to observe the current failure before editing, then inspect the current source and test state; do not assume which implementation detail regressed.
- Use filesystem or structured edit tools for every read and mutation.
- The only shell command permitted is exactly: node --test
- Run that test command, use its result as evidence, and correct the root cause until it passes.
- Do not modify TASK.md, package.json, or anything under test/.
- Do not use network, browser, MCP, subagents, workflows, or background jobs.
- Conclude only after a successful test result is visible in this turn. State the evidence briefly; do not create a completion receipt file.`
}

function hiddenOracleSource(fixtureRoot: string): string {
  const orderSummaryUrl = JSON.stringify(pathToFileURL(join(fixtureRoot, 'src', 'order-summary.mjs')).href)
  const reportUrl = JSON.stringify(pathToFileURL(join(fixtureRoot, 'src', 'report.mjs')).href)
  return `import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrderSummary } from ${orderSummaryUrl}
import { renderOrderReport } from ${reportUrl}

test('hidden product oracle', () => {
  const items = [{ quantity: 1, unitPrice: 10.235 }, { quantity: 2, unitPrice: 4.5 }]
  const before = structuredClone(items)
  assert.deepEqual(createOrderSummary(items, -20), { subtotal: 19.24, discount: 0, total: 19.24 })
  assert.deepEqual(items, before)
  assert.deepEqual(
    createOrderSummary([{ quantity: 1, unitPrice: 19.99 }], 101),
    { subtotal: 19.99, discount: 19.99, total: 0 },
  )
  const summary = createOrderSummary([{ quantity: 1, unitPrice: 10.235 }], 10)
  assert.deepEqual(summary, { subtotal: 10.24, discount: 1.02, total: 9.22 })
  assert.equal(
    renderOrderReport(summary),
    'Subtotal: R$ 10.24\\nDesconto: R$ 1.02\\nTotal: R$ 9.22',
  )
})
`
}

async function readOnlySessionLog(dshHome: string): Promise<readonly unknown[]> {
  const paths = await findNamedFiles(join(dshHome, 'sessions'), 'session.jsonl')
  if (paths.length !== 1) throw new BenchmarkFailure('SESSION_LOG_COUNT_INVALID')
  const sessionPath = paths[0]
  if (sessionPath === undefined) throw new BenchmarkFailure('SESSION_LOG_COUNT_INVALID')
  const lines = (await readFile(sessionPath, 'utf8')).split(/\r?\n/u).filter(line => line.trim() !== '')
  try {
    return lines.map(line => JSON.parse(line) as unknown)
  } catch {
    throw new BenchmarkFailure('SESSION_LOG_INVALID_JSONL')
  }
}

async function findNamedFiles(directory: string, name: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const output: string[] = []
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await findNamedFiles(absolute, name))
    else if (entry.isFile() && entry.name === name) output.push(absolute)
  }
  return output.sort()
}

function childEnvironment(dshHome: string, fixtureRoot: string): NodeJS.ProcessEnv {
  const environment = allowlistedHostEnvironment()
  return {
    ...environment,
    DSH_HOME: dshHome,
    DSH_PERMISSION_MODE: 'workspace-write',
    DSH_TELEMETRY_DISABLED: '1',
    LEON_DEFAULT_WORKSPACE: fixtureRoot,
    NO_COLOR: '1',
    NO_PROXY: '127.0.0.1,::1',
  }
}

function hostOracleEnvironment(): NodeJS.ProcessEnv {
  return { ...allowlistedHostEnvironment(), NO_COLOR: '1' }
}

function allowlistedHostEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {}
  const names = [
    'APPDATA',
    'CommonProgramFiles',
    'CommonProgramFiles(x86)',
    'ComSpec',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'Path',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'SystemDrive',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'windir',
  ] as const
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) output[name] = value
  }
  if (EXTERNAL_CREDENTIAL_KEYS.some(name => name in output)) {
    throw new BenchmarkFailure('ENV_ALLOWLIST_CONTAINS_EXTERNAL_CREDENTIAL')
  }
  return output
}

function parseArgs(args: readonly string[]): Options {
  let implementationModel = DEFAULT_IMPLEMENTATION_MODEL
  let recoveryModel = DEFAULT_RECOVERY_MODEL
  let ollamaUrl = leonAcc008LoopbackUrl(DEFAULT_OLLAMA_URL)
  let outputPath = DEFAULT_OUTPUT
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--implementation-model') {
      implementationModel = requiredModel(value, argument)
    } else if (argument === '--recovery-model') {
      recoveryModel = requiredModel(value, argument)
    } else if (argument === '--ollama-url') {
      if (value === undefined) throw new BenchmarkFailure('OLLAMA_URL_ARGUMENT_MISSING')
      ollamaUrl = leonAcc008LoopbackUrl(value)
    } else if (argument === '--output') {
      if (value === undefined || value.trim() === '') throw new BenchmarkFailure('OUTPUT_ARGUMENT_MISSING')
      outputPath = value
    } else {
      throw new BenchmarkFailure('UNKNOWN_ARGUMENT')
    }
    index += 1
  }
  return { implementationModel, recoveryModel, ollamaUrl, outputPath }
}

function requiredModel(value: string | undefined, option: string): string {
  if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value)) {
    throw new BenchmarkFailure(`${stableId(option)}_INVALID`)
  }
  return value
}

async function requireFile(path: string, code: string): Promise<void> {
  try {
    await readFile(path)
  } catch {
    throw new BenchmarkFailure(code)
  }
}

function failureArtifact(options: Options, code: string): FailedArtifact {
  return {
    schemaVersion: LEON_ACCEPTANCE_8_SCHEMA_VERSION,
    benchmark: 'LEON-ACC-008-long-autonomous-v1',
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    status: 'failed',
    failures: [code],
    localOnly: true,
    ollamaOrigin: options.ollamaUrl.origin,
    externalCredentialVariablesPresent: [],
    temporaryFixtureDeleted: true,
  }
}

async function writeArtifact(path: string, artifact: BenchmarkArtifact | FailedArtifact): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await rm(path, { force: true })
  await rename(temporaryPath, path)
}

function printSummary(artifact: BenchmarkArtifact | FailedArtifact, outputPath: string): void {
  console.log(`LEON-ACC-008: ${artifact.status === 'passed' ? 'APROVADO' : 'AINDA NÃO APROVADO'}`)
  console.log(`Falhas: ${artifact.failures.join(', ') || 'nenhuma'}`)
  console.log(`Relatório sanitizado: ${outputPath}`)
}

function failureCode(error: unknown): string {
  if (error instanceof BenchmarkFailure) return error.code
  if (isRecord(error) && error.name === 'TimeoutError') return 'STAGE_TIMEOUT'
  return 'UNEXPECTED_RUNNER_ERROR'
}

function stableId(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, '_').replaceAll(/^_|_$/gu, '')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
