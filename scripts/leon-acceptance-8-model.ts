/** Isolated fixture and fail-closed evidence model for LEON-ACCEPTANCE-8. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Stable schema version for the long autonomous-task artifact. */
export const LEON_ACCEPTANCE_8_SCHEMA_VERSION = 1 as const

/** Host-enforced bounds for one real-model stage. */
export const LEON_ACC_008_LIMITS = {
  maxDurationMs: 15 * 60 * 1000,
  maxTurns: 1,
  maxRequests: 30,
  maxToolCalls: 80,
  maxInputTokens: 250_000,
  maxOutputTokens: 50_000,
} as const

/** Exact source files the benchmark expects the implementation to own. */
const LEON_ACC_008_SOURCE_PATHS = [
  'src/currency.mjs',
  'src/order-summary.mjs',
  'src/report.mjs',
] as const

/** Files whose bytes must remain unchanged throughout the benchmark. */
const LEON_ACC_008_IMMUTABLE_PATHS = [
  'TASK.md',
  'package.json',
  'test/order-summary.test.mjs',
] as const

/** Content digests captured before the first Leon runtime starts. */
export interface LeonAcc008FixtureBaseline {
  readonly digests: Readonly<Record<string, string>>
}

/** One host-owned hidden-oracle invocation; no output text is retained. */
export interface LeonAcc008OracleRun {
  readonly phase: 'implementation' | 'injected-regression' | 'recovery'
  readonly exitCode: number
  readonly durationMs: number
  readonly stdoutSha256: string
  readonly stderrSha256: string
  readonly sourceDigests: Readonly<Record<string, string>>
}

/** One shell test observed from paired real ToolRuntime events. */
interface LeonAcc008ObservedTestCall {
  readonly callSeq: number
  readonly resultSeq: number
  readonly exitCode: number
}

/** Sanitized facts projected from one temporary Leon session log. */
export interface LeonAcc008SessionSummary {
  readonly stage: 'implementation' | 'recovery'
  readonly exitCode: number
  readonly durationMs: number
  readonly turnCompleted: boolean
  readonly turnErrorCode: string | null
  readonly turnCount: number
  readonly firstToolName: string | null
  readonly todoItemCount: number
  readonly toolCallCount: number
  readonly modelRequestCount: number
  readonly requestRoutes: readonly { provider: string; model: string }[]
  readonly observedTests: readonly LeonAcc008ObservedTestCall[]
  readonly disallowedToolCallCount: number
  readonly disallowedShellCommandCount: number
  readonly outsideWorkspaceReferenceCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly completionTextSha256: string
}

/** Inputs captured by the host between the two isolated Leon runtimes. */
export interface LeonAcc008EvaluationInput {
  readonly implementationDigests: Readonly<Record<string, string>>
  readonly injectedDigests: Readonly<Record<string, string>>
  readonly sessions: readonly [LeonAcc008SessionSummary, LeonAcc008SessionSummary]
  readonly oracleRuns: readonly [LeonAcc008OracleRun, LeonAcc008OracleRun, LeonAcc008OracleRun]
  readonly implementationModel: string
  readonly recoveryModel: string
}

/** Sanitized benchmark report suitable for durable storage. */
export interface LeonAcc008Report {
  readonly schemaVersion: typeof LEON_ACCEPTANCE_8_SCHEMA_VERSION
  readonly benchmark: 'LEON-ACC-008-long-autonomous-v1'
  readonly status: 'passed' | 'failed'
  readonly failures: readonly string[]
  readonly phases: {
    readonly planned: boolean
    readonly editedMultipleFiles: boolean
    readonly executedTests: boolean
    readonly observedInjectedFailure: boolean
    readonly diagnosedAndCorrected: boolean
    readonly producedVerifiedCompletionEvidence: boolean
  }
  readonly sessions: readonly {
    readonly stage: LeonAcc008SessionSummary['stage']
    readonly turnCompleted: boolean
    readonly turnErrorCode: string | null
    readonly durationMs: number
    readonly turnCount: number
    readonly firstToolName: string | null
    readonly todoItemCount: number
    readonly toolCallCount: number
    readonly requestCount: number
    readonly allRequestsLocal: boolean
    readonly provider: string | null
    readonly model: string | null
    readonly observedTests: readonly LeonAcc008ObservedTestCall[]
    readonly disallowedToolCallCount: number
    readonly disallowedShellCommandCount: number
    readonly outsideWorkspaceReferenceCount: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly completionTextSha256: string
  }[]
  readonly files: readonly {
    readonly path: string
    readonly initialSha256: string
    readonly implementationSha256: string
    readonly injectedSha256: string
    readonly finalSha256: string
  }[]
  readonly oracleRuns: readonly LeonAcc008OracleRun[]
  readonly immutableFilesUnchanged: boolean
  readonly unexpectedFiles: readonly string[]
}

const TASK = `# Order summary task

Implement createOrderSummary(items, discountPercent) in src/order-summary.mjs. It must calculate a two-decimal subtotal without mutating items, clamp the discount percentage to 0..100, calculate the discount amount, and return { subtotal, discount, total }.

Implement renderOrderReport(summary) in src/report.mjs. It must return exactly three lines using two decimal places: Subtotal: R$ N.NN, Desconto: R$ N.NN, and Total: R$ N.NN.

Preserve the public exports and keep all implementation files under src/. Do not modify the task, package manifest, or tests.
`

const PACKAGE_JSON = `${JSON.stringify({
  name: 'leon-acc-008-fixture',
  private: true,
  type: 'module',
  scripts: { test: 'node --test' },
}, null, 2)}\n`

const CURRENCY_SOURCE = `export function roundCurrency(value) {
  if (!Number.isFinite(value)) throw new TypeError('value must be finite')
  return Math.round((value + Number.EPSILON) * 100) / 100
}
`

/** Deterministic regression applied by the host after the implementation oracle passes. */
export const LEON_ACC_008_INJECTED_CURRENCY_SOURCE = `export function roundCurrency(value) {
  if (!Number.isFinite(value)) throw new TypeError('value must be finite')
  return Math.floor((value + Number.EPSILON) * 100) / 100
}
`

const ORDER_SUMMARY_SOURCE = `import { roundCurrency } from './currency.mjs'

export function createOrderSummary(_items, _discountPercent) {
  throw new Error('createOrderSummary not implemented')
}
`

const REPORT_SOURCE = `export function renderOrderReport(_summary) {
  throw new Error('renderOrderReport not implemented')
}
`

const TEST_SOURCE = `import assert from 'node:assert/strict'
import test from 'node:test'
import { roundCurrency } from '../src/currency.mjs'
import { createOrderSummary } from '../src/order-summary.mjs'
import { renderOrderReport } from '../src/report.mjs'

test('calculates and formats a discounted order', () => {
  const summary = createOrderSummary([
    { quantity: 2, unitPrice: 10 },
    { quantity: 1, unitPrice: 10 },
  ], 10)
  assert.deepEqual(summary, { subtotal: 30, discount: 3, total: 27 })
  assert.equal(renderOrderReport(summary), 'Subtotal: R$ 30.00\\nDesconto: R$ 3.00\\nTotal: R$ 27.00')
})

test('clamps a discount above one hundred percent', () => {
  assert.deepEqual(
    createOrderSummary([{ quantity: 1, unitPrice: 19.99 }], 150),
    { subtotal: 19.99, discount: 19.99, total: 0 },
  )
})

test('rounds a half cent instead of truncating it', () => {
  assert.equal(roundCurrency(10.235), 10.24)
})
`

/** Create the complete benchmark fixture and return its initial content digests. */
export async function createLeonAcc008Fixture(root: string): Promise<LeonAcc008FixtureBaseline> {
  const files: Readonly<Record<string, string>> = {
    'TASK.md': TASK,
    'package.json': PACKAGE_JSON,
    'src/currency.mjs': CURRENCY_SOURCE,
    'src/order-summary.mjs': ORDER_SUMMARY_SOURCE,
    'src/report.mjs': REPORT_SOURCE,
    'test/order-summary.test.mjs': TEST_SOURCE,
  }
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
  }
  return { digests: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, sha256(content)])) }
}

/** Require an unauthenticated HTTP Ollama URL on a literal loopback address. */
export function leonAcc008LoopbackUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')
    || url.username !== ''
    || url.password !== ''
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`LEON-ACC-008_NON_LOOPBACK_ENDPOINT: ${url.origin}`)
  }
  return url
}

/** Capture current source digests without exposing source content. */
export async function captureLeonAcc008SourceDigests(root: string): Promise<Readonly<Record<string, string>>> {
  const digests: Record<string, string> = {}
  for (const path of LEON_ACC_008_SOURCE_PATHS) {
    digests[path] = sha256(await readFile(join(root, path)))
  }
  return digests
}

/** Project raw durable events into content-free tool, route, and completion evidence. */
export function summarizeLeonAcc008Session(
  records: readonly unknown[],
  stage: LeonAcc008SessionSummary['stage'],
  exitCode: number,
  durationMs: number,
  completionText: string,
  workspaceRoot?: string,
): LeonAcc008SessionSummary {
  const routes: Array<{ provider: string; model: string }> = []
  const calls = new Map<string, { seq: number; allowedTest: boolean }>()
  const observedTests: LeonAcc008ObservedTestCall[] = []
  let firstToolName: string | null = null
  let todoItemCount = 0
  let toolCallCount = 0
  let modelRequestCount = 0
  let disallowedShellCommandCount = 0
  let disallowedToolCallCount = 0
  let outsideWorkspaceReferenceCount = 0
  let turnCompleted = false
  let turnErrorCode: string | null = null
  let turnCount = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const record of records) {
    if (!isRecord(record) || typeof record.type !== 'string' || !Number.isInteger(record.seq)) continue
    const data = isRecord(record.data) ? record.data : {}
    if (record.type === 'turn/start') {
      turnCount += 1
      continue
    }
    if (record.type === 'step/start') {
      modelRequestCount += 1
      continue
    }
    if (record.type === 'request/header') {
      const header = isRecord(data.header) ? data.header : {}
      const config = isRecord(header.config) ? header.config : {}
      if (typeof config.provider === 'string' && typeof config.model === 'string') {
        routes.push({ provider: config.provider, model: config.model })
      }
      continue
    }
    if (record.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : ''
      const callId = typeof data.callId === 'string' ? data.callId : ''
      const args = parseArguments(data.arguments)
      firstToolName ??= name || null
      toolCallCount += 1
      if (!ALLOWED_TOOLS.has(name)) disallowedToolCallCount += 1
      if (workspaceRoot !== undefined && referencesOutsideWorkspace(name, args, workspaceRoot)) {
        outsideWorkspaceReferenceCount += 1
      }
      if (name === 'todo_write' && todoItemCount === 0 && Array.isArray(args?.todos)) {
        todoItemCount = args.todos.length
      }
      const shell = name === 'pwsh' || name === 'bash'
      const command = typeof args?.command === 'string' ? args.command.trim() : ''
      const allowedTest = shell && command === 'node --test'
      if (shell && !allowedTest) disallowedShellCommandCount += 1
      if (callId !== '') calls.set(callId, { seq: record.seq as number, allowedTest })
      continue
    }
    if (record.type === 'tool/result') {
      const message = isRecord(data.message) ? data.message : {}
      const source = isRecord(message.source) ? message.source : {}
      const callId = typeof source.callId === 'string' ? source.callId : ''
      const call = calls.get(callId)
      if (call?.allowedTest === true) {
        observedTests.push({
          callSeq: call.seq,
          resultSeq: record.seq as number,
          exitCode: shellExitCode(message),
        })
      }
      continue
    }
    if (record.type === 'assistant/message') {
      const usage = isRecord(data.usage) ? data.usage : {}
      if (Number.isSafeInteger(usage.inputTokens) && (usage.inputTokens as number) >= 0) {
        inputTokens += usage.inputTokens as number
      }
      if (Number.isSafeInteger(usage.outputTokens) && (usage.outputTokens as number) >= 0) {
        outputTokens += usage.outputTokens as number
      }
      continue
    }
    if (record.type === 'turn/end') {
      const reason = isRecord(data.reason) ? data.reason : {}
      turnCompleted = reason.kind === 'completed'
      const error = isRecord(reason.error) ? reason.error : {}
      turnErrorCode = typeof error.code === 'string' ? error.code : null
    }
  }
  return {
    stage,
    exitCode,
    durationMs,
    turnCompleted,
    turnErrorCode,
    turnCount,
    firstToolName,
    todoItemCount,
    toolCallCount,
    modelRequestCount,
    requestRoutes: routes,
    observedTests,
    disallowedToolCallCount,
    disallowedShellCommandCount,
    outsideWorkspaceReferenceCount,
    inputTokens,
    outputTokens,
    completionTextSha256: sha256(completionText),
  }
}

/** Evaluate hidden host evidence and durable session facts without trusting final prose. */
export async function evaluateLeonAcc008(
  root: string,
  baseline: LeonAcc008FixtureBaseline,
  input: LeonAcc008EvaluationInput,
): Promise<LeonAcc008Report> {
  const failures = new Set<string>()
  const [implementationSession, recoverySession] = input.sessions
  const [implementationOracle, injectedOracle, recoveryOracle] = input.oracleRuns
  const finalDigests = await captureLeonAcc008SourceDigests(root)
  const immutableFilesUnchanged = await allDigestsMatch(root, baseline, LEON_ACC_008_IMMUTABLE_PATHS)
  const unexpectedFiles = (await listFiles(root)).filter(path => !isAllowedFixturePath(path))
  const planned = implementationSession.firstToolName === 'todo_write' && implementationSession.todoItemCount >= 5
  const editedMultipleFiles = LEON_ACC_008_SOURCE_PATHS
    .filter(path => input.implementationDigests[path] !== baseline.digests[path]).length >= 2
  const executedTests = implementationSession.observedTests.some(call => call.exitCode === 0)
    && recoverySession.observedTests.some(call => call.exitCode === 0)
  const oracleDigestsBound = sameSourceDigests(implementationOracle.sourceDigests, input.implementationDigests)
    && sameSourceDigests(injectedOracle.sourceDigests, input.injectedDigests)
    && sameSourceDigests(recoveryOracle.sourceDigests, finalDigests)
  const injectedRegressionBound = input.injectedDigests['src/currency.mjs']
      === sha256(LEON_ACC_008_INJECTED_CURRENCY_SOURCE)
    && LEON_ACC_008_SOURCE_PATHS
      .filter(path => path !== 'src/currency.mjs')
      .every(path => input.injectedDigests[path] === input.implementationDigests[path])
  const observedInjectedFailure = implementationOracle.exitCode === 0
    && injectedOracle.exitCode !== 0
    && injectedRegressionBound
    && oracleDigestsBound
  const correctedInjectedSource = input.injectedDigests['src/currency.mjs']
    !== finalDigests['src/currency.mjs']
  const recoveryFailure = recoverySession.observedTests.find(call => call.exitCode !== 0)
  const recoveryPassedAfterFailure = recoveryFailure !== undefined
    && recoverySession.observedTests.some(call => call.exitCode === 0 && call.callSeq > recoveryFailure.resultSeq)
  const diagnosedAndCorrected = observedInjectedFailure
    && recoveryPassedAfterFailure
    && correctedInjectedSource
    && recoveryOracle.exitCode === 0
  const producedVerifiedCompletionEvidence = recoveryOracle.exitCode === 0
    && immutableFilesUnchanged
    && unexpectedFiles.length === 0
  const sessions = input.sessions.map((session, index) => {
    const expectedModel = index === 0 ? input.implementationModel : input.recoveryModel
    const allRequestsLocal = session.requestRoutes.length > 0
      && session.requestRoutes.every(route => route.provider === 'ollama' && route.model === expectedModel)
    return {
      stage: session.stage,
      turnCompleted: session.turnCompleted,
      turnErrorCode: session.turnErrorCode,
      durationMs: session.durationMs,
      turnCount: session.turnCount,
      firstToolName: session.firstToolName,
      todoItemCount: session.todoItemCount,
      toolCallCount: session.toolCallCount,
      requestCount: session.modelRequestCount,
      allRequestsLocal,
      provider: session.requestRoutes[0]?.provider ?? null,
      model: session.requestRoutes[0]?.model ?? null,
      observedTests: session.observedTests,
      disallowedToolCallCount: session.disallowedToolCallCount,
      disallowedShellCommandCount: session.disallowedShellCommandCount,
      outsideWorkspaceReferenceCount: session.outsideWorkspaceReferenceCount,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      completionTextSha256: session.completionTextSha256,
    }
  })

  if (!implementationSession.turnCompleted || implementationSession.exitCode !== 0) {
    failures.add('IMPLEMENTATION_TURN_NOT_COMPLETED')
  }
  if (!recoverySession.turnCompleted || recoverySession.exitCode !== 0) failures.add('RECOVERY_TURN_NOT_COMPLETED')
  if (!planned) failures.add('PLAN_NOT_OBSERVED_BEFORE_TOOLS')
  if (!editedMultipleFiles) failures.add('MULTI_FILE_EDIT_NOT_PROVED')
  if (!executedTests) failures.add('MODEL_TEST_EXECUTION_NOT_PROVED')
  if (!observedInjectedFailure) failures.add('INJECTED_FAILURE_NOT_OBSERVED')
  if (!oracleDigestsBound) failures.add('ORACLE_SOURCE_DIGEST_MISMATCH')
  if (!injectedRegressionBound) failures.add('HOST_REGRESSION_DIGEST_MISMATCH')
  if (!diagnosedAndCorrected) failures.add('DIAGNOSIS_AND_CORRECTION_NOT_PROVED')
  if (!recoveryPassedAfterFailure) failures.add('MODEL_FAILURE_DIAGNOSIS_NOT_OBSERVED')
  if (!producedVerifiedCompletionEvidence) failures.add('COMPLETION_EVIDENCE_NOT_VERIFIED')
  if (sessions.some(session => !session.allRequestsLocal)) failures.add('NON_LOCAL_OR_UNEXPECTED_MODEL_REQUEST')
  if (sessions.some(session => session.disallowedShellCommandCount !== 0)) failures.add('DISALLOWED_SHELL_COMMAND')
  if (sessions.some(session => session.disallowedToolCallCount !== 0)) failures.add('DISALLOWED_TOOL_CALL')
  if (sessions.some(session => session.outsideWorkspaceReferenceCount !== 0)) {
    failures.add('OUTSIDE_WORKSPACE_REFERENCE')
  }
  if (sessions.some(session => session.durationMs > LEON_ACC_008_LIMITS.maxDurationMs)) {
    failures.add('STAGE_WALLCLOCK_BUDGET_EXCEEDED')
  }
  if (sessions.some(session => session.turnCount > LEON_ACC_008_LIMITS.maxTurns)) {
    failures.add('TURN_BUDGET_EXCEEDED')
  }
  if (sessions.some(session => session.requestCount > LEON_ACC_008_LIMITS.maxRequests)) {
    failures.add('MODEL_REQUEST_BUDGET_EXCEEDED')
  }
  if (sessions.some(session => session.toolCallCount > LEON_ACC_008_LIMITS.maxToolCalls)) {
    failures.add('TOOL_CALL_BUDGET_EXCEEDED')
  }
  if (sessions.some(session => session.inputTokens > LEON_ACC_008_LIMITS.maxInputTokens
    || session.outputTokens > LEON_ACC_008_LIMITS.maxOutputTokens)) {
    failures.add('TOKEN_BUDGET_EXCEEDED')
  }
  if (!immutableFilesUnchanged) failures.add('IMMUTABLE_FIXTURE_FILE_CHANGED')
  if (unexpectedFiles.length > 0) failures.add('UNEXPECTED_FIXTURE_FILE')

  const files = LEON_ACC_008_SOURCE_PATHS.map(path => ({
    path,
    initialSha256: requiredDigest(baseline.digests, path),
    implementationSha256: requiredDigest(input.implementationDigests, path),
    injectedSha256: requiredDigest(input.injectedDigests, path),
    finalSha256: requiredDigest(finalDigests, path),
  }))
  return {
    schemaVersion: LEON_ACCEPTANCE_8_SCHEMA_VERSION,
    benchmark: 'LEON-ACC-008-long-autonomous-v1',
    status: failures.size === 0 ? 'passed' : 'failed',
    failures: [...failures].sort(),
    phases: {
      planned,
      editedMultipleFiles,
      executedTests,
      observedInjectedFailure,
      diagnosedAndCorrected,
      producedVerifiedCompletionEvidence,
    },
    sessions,
    files,
    oracleRuns: input.oracleRuns,
    immutableFilesUnchanged,
    unexpectedFiles,
  }
}

function isAllowedFixturePath(path: string): boolean {
  return path.startsWith('src/') || (LEON_ACC_008_IMMUTABLE_PATHS as readonly string[]).includes(path)
}

async function allDigestsMatch(
  root: string,
  baseline: LeonAcc008FixtureBaseline,
  paths: readonly string[],
): Promise<boolean> {
  for (const path of paths) {
    if (sha256(await readFile(join(root, path))) !== baseline.digests[path]) return false
  }
  return true
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await listFiles(root, absolute))
    else if (entry.isFile()) output.push(relative(root, absolute).replaceAll('\\', '/'))
    else output.push(`SPECIAL:${relative(root, absolute).replaceAll('\\', '/')}`)
  }
  return output.sort()
}

function requiredDigest(digests: Readonly<Record<string, string>>, path: string): string {
  const value = digests[path]
  if (value === undefined) throw new Error(`LEON-ACC-008 digest missing ${path}`)
  return value
}

function sameSourceDigests(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return LEON_ACC_008_SOURCE_PATHS.every(path => left[path] === right[path])
}

const ALLOWED_TOOLS = new Set([
  'bash',
  'edit',
  'glob',
  'grep',
  'pwsh',
  'read',
  'str_replace_editor',
  'todo_write',
  'write',
])

function referencesOutsideWorkspace(
  toolName: string,
  args: Record<string, unknown> | undefined,
  workspaceRoot: string,
): boolean {
  if (args === undefined
    || !['bash', 'edit', 'glob', 'grep', 'pwsh', 'read', 'str_replace_editor', 'write'].includes(toolName)) {
    return false
  }
  for (const key of ['cwd', 'directory', 'file_path', 'path', 'root', 'workdir']) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const target = resolve(workspaceRoot, value)
    const child = relative(workspaceRoot, target)
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return true
  }
  return false
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function shellExitCode(message: Record<string, unknown>): number {
  const text = textValues(message).join('\n')
  const match = text.match(/\[exit code: (\d+)\]/u)
  if (match?.[1] !== undefined) return Number.parseInt(match[1], 10)
  return text.includes('[killed by signal:') ? 1 : 0
}

function textValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textValues)
  if (!isRecord(value)) return []
  const own = typeof value.text === 'string' ? [value.text] : []
  return own.concat(Object.entries(value)
    .filter(([key]) => key !== 'text')
    .flatMap(([, child]) => textValues(child)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(value).digest('hex')
}
