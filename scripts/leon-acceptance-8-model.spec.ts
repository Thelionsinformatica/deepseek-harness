/** Deterministic, keyless contracts for the LEON-ACC-008 evidence gate. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureLeonAcc008SourceDigests,
  createLeonAcc008Fixture,
  evaluateLeonAcc008,
  LEON_ACC_008_INJECTED_CURRENCY_SOURCE,
  leonAcc008LoopbackUrl,
  summarizeLeonAcc008Session,
  type LeonAcc008OracleRun,
  type LeonAcc008SessionSummary,
} from './leon-acceptance-8-model.ts'

const VALID_CURRENCY = `export function roundCurrency(value) {
  if (!Number.isFinite(value)) throw new TypeError('value must be finite')
  return Math.round((value + Number.EPSILON) * 100) / 100
}
`

const VALID_ORDER_SUMMARY = `import { roundCurrency } from './currency.mjs'

export function createOrderSummary(items, discountPercent) {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))
  const percent = Math.min(100, Math.max(0, discountPercent))
  const discount = roundCurrency(subtotal * percent / 100)
  return { subtotal, discount, total: roundCurrency(subtotal - discount) }
}
`

const VALID_REPORT = `export function renderOrderReport(summary) {
  return [
    \`Subtotal: R$ \${summary.subtotal.toFixed(2)}\`,
    \`Desconto: R$ \${summary.discount.toFixed(2)}\`,
    \`Total: R$ \${summary.total.toFixed(2)}\`,
  ].join('\\n')
}
`

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LEON-ACC-008 evidence model', () => {
  it('accepts only unauthenticated literal-loopback Ollama origins', () => {
    expect(leonAcc008LoopbackUrl('http://127.0.0.1:11434').origin).toBe('http://127.0.0.1:11434')
    expect(leonAcc008LoopbackUrl('http://[::1]:11434').origin).toBe('http://[::1]:11434')
    for (const url of [
      'https://127.0.0.1:11434',
      'http://localhost:11434',
      'http://user:secret@127.0.0.1:11434',
      'http://127.0.0.1:11434/api',
      'http://192.168.1.2:11434',
    ]) {
      expect(() => leonAcc008LoopbackUrl(url)).toThrow('LEON-ACC-008_NON_LOOPBACK_ENDPOINT')
    }
  })

  it('projects paired runtime events without retaining prompts, results, or completion prose', () => {
    const records = [
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'step/start', { turn: 1, step: 1 }),
      at(2, 'request/header', { header: { config: { provider: 'ollama', model: 'qwen3.5:9b' } } }),
      at(3, 'tool/call', {
        callId: 'todo-1',
        name: 'todo_write',
        arguments: JSON.stringify({ todos: Array.from({ length: 5 }, (_, index) => ({ content: `s${index}`, status: 'pending' })) }),
      }),
      at(4, 'tool/call', { callId: 'test-fail', name: 'pwsh', arguments: '{"command":"node --test"}' }),
      at(5, 'tool/result', result('test-fail', 'failure\n[exit code: 1]')),
      at(6, 'tool/call', { callId: 'bad-shell', name: 'pwsh', arguments: '{"command":"Get-ChildItem"}' }),
      at(7, 'tool/result', result('bad-shell', 'not retained')),
      at(8, 'tool/call', { callId: 'test-pass', name: 'pwsh', arguments: '{"command":"node --test"}' }),
      at(9, 'tool/result', result('test-pass', 'all pass')),
      at(10, 'assistant/message', { usage: { inputTokens: 100, outputTokens: 25 } }),
      at(11, 'turn/end', { reason: { kind: 'completed' } }),
    ]
    const summary = summarizeLeonAcc008Session(records, 'implementation', 0, 321, 'sensitive final prose', 'C:\\fixture')
    expect(summary).toMatchObject({
      stage: 'implementation',
      durationMs: 321,
      turnCompleted: true,
      turnErrorCode: null,
      turnCount: 1,
      firstToolName: 'todo_write',
      todoItemCount: 5,
      toolCallCount: 4,
      modelRequestCount: 1,
      disallowedToolCallCount: 0,
      disallowedShellCommandCount: 1,
      outsideWorkspaceReferenceCount: 0,
      inputTokens: 100,
      outputTokens: 25,
      requestRoutes: [{ provider: 'ollama', model: 'qwen3.5:9b' }],
      observedTests: [
        { callSeq: 4, resultSeq: 5, exitCode: 1 },
        { callSeq: 8, resultSeq: 9, exitCode: 0 },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain('sensitive final prose')
    expect(JSON.stringify(summary)).not.toContain('not retained')
    expect(summary.completionTextSha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('projects unapproved tools and file references that escape the workspace', () => {
    const summary = summarizeLeonAcc008Session([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'step/start', { turn: 1, step: 1 }),
      at(2, 'tool/call', {
        callId: 'outside',
        name: 'read',
        arguments: '{"file_path":"../host-oracle/hidden.test.mjs"}',
      }),
      at(3, 'tool/call', { callId: 'unknown', name: 'browser_open', arguments: '{}' }),
    ], 'recovery', 1, 10, '', 'C:\\fixture')
    expect(summary.outsideWorkspaceReferenceCount).toBe(1)
    expect(summary.disallowedToolCallCount).toBe(1)
  })

  it('runs the isolated fixture through fail, pass, injected fail, and repaired pass states', async () => {
    const root = await fixture()
    expect(await nodeTest(root)).not.toBe(0)
    await installValidImplementation(root)
    expect(await nodeTest(root)).toBe(0)
    await writeFile(join(root, 'src', 'currency.mjs'), LEON_ACC_008_INJECTED_CURRENCY_SOURCE, 'utf8')
    expect(await nodeTest(root)).not.toBe(0)
    await writeFile(join(root, 'src', 'currency.mjs'), VALID_CURRENCY, 'utf8')
    expect(await nodeTest(root)).toBe(0)
  })

  it('passes only with local runtime evidence bound to the exact host-oracle source digests', async () => {
    const state = await passingState()
    const report = await evaluateLeonAcc008(state.root, state.baseline, state.input)
    expect(report.status).toBe('passed')
    expect(report.failures).toEqual([])
    expect(report.phases).toEqual({
      planned: true,
      editedMultipleFiles: true,
      executedTests: true,
      observedInjectedFailure: true,
      diagnosedAndCorrected: true,
      producedVerifiedCompletionEvidence: true,
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(state.root)
    expect(serialized).not.toContain('createOrderSummary(items')
  })

  it('fails closed on forged oracle binding, protected-file edits, unsafe shell, and non-local routes', async () => {
    const state = await passingState()
    await writeFile(join(state.root, 'TASK.md'), 'tampered\n', 'utf8')
    const forgedOracle = { ...state.input.oracleRuns[2], sourceDigests: state.input.injectedDigests }
    const unsafeRecovery: LeonAcc008SessionSummary = {
      ...state.input.sessions[1],
      requestRoutes: [{ provider: 'google', model: 'gemini' }],
      disallowedShellCommandCount: 1,
      disallowedToolCallCount: 1,
      outsideWorkspaceReferenceCount: 1,
    }
    const report = await evaluateLeonAcc008(state.root, state.baseline, {
      ...state.input,
      sessions: [state.input.sessions[0], unsafeRecovery],
      oracleRuns: [state.input.oracleRuns[0], state.input.oracleRuns[1], forgedOracle],
    })
    expect(report.status).toBe('failed')
    expect(report.failures).toEqual(expect.arrayContaining([
      'COMPLETION_EVIDENCE_NOT_VERIFIED',
      'DISALLOWED_SHELL_COMMAND',
      'DISALLOWED_TOOL_CALL',
      'IMMUTABLE_FIXTURE_FILE_CHANGED',
      'NON_LOCAL_OR_UNEXPECTED_MODEL_REQUEST',
      'ORACLE_SOURCE_DIGEST_MISMATCH',
      'OUTSIDE_WORKSPACE_REFERENCE',
    ]))
  })
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leon-acc-008-spec-'))
  temporaryRoots.push(root)
  await createLeonAcc008Fixture(root)
  return root
}

async function installValidImplementation(root: string): Promise<void> {
  await Promise.all([
    writeFile(join(root, 'src', 'currency.mjs'), VALID_CURRENCY, 'utf8'),
    writeFile(join(root, 'src', 'order-summary.mjs'), VALID_ORDER_SUMMARY, 'utf8'),
    writeFile(join(root, 'src', 'report.mjs'), VALID_REPORT, 'utf8'),
  ])
}

async function nodeTest(root: string): Promise<number> {
  const run = await execa(process.execPath, ['--test'], { cwd: root, reject: false })
  return run.exitCode ?? 1
}

async function passingState(): Promise<{
  root: string
  baseline: Awaited<ReturnType<typeof createLeonAcc008Fixture>>
  input: Parameters<typeof evaluateLeonAcc008>[2]
}> {
  const root = await fixture()
  const baseline = await createLeonAcc008Fixture(root)
  await installValidImplementation(root)
  const implementationDigests = await captureLeonAcc008SourceDigests(root)
  await writeFile(join(root, 'src', 'currency.mjs'), LEON_ACC_008_INJECTED_CURRENCY_SOURCE, 'utf8')
  const injectedDigests = await captureLeonAcc008SourceDigests(root)
  await writeFile(join(root, 'src', 'currency.mjs'), VALID_CURRENCY, 'utf8')
  const recoveryDigests = await captureLeonAcc008SourceDigests(root)
  const implementation = session('implementation', 'qwen3.5:9b', true)
  const recovery = session('recovery', 'ornith-1.5:9b', false)
  return {
    root,
    baseline,
    input: {
      implementationDigests,
      injectedDigests,
      sessions: [implementation, recovery],
      oracleRuns: [
        oracle('implementation', 0, implementationDigests),
        oracle('injected-regression', 1, injectedDigests),
        oracle('recovery', 0, recoveryDigests),
      ],
      implementationModel: 'qwen3.5:9b',
      recoveryModel: 'ornith-1.5:9b',
    },
  }
}

function session(
  stage: LeonAcc008SessionSummary['stage'],
  model: string,
  planned: boolean,
): LeonAcc008SessionSummary {
  return {
    stage,
    exitCode: 0,
    durationMs: 100,
    turnCompleted: true,
    turnErrorCode: null,
    turnCount: 1,
    firstToolName: planned ? 'todo_write' : 'read',
    todoItemCount: planned ? 5 : 0,
    toolCallCount: 8,
    modelRequestCount: 4,
    requestRoutes: [{ provider: 'ollama', model }],
    observedTests: stage === 'recovery'
      ? [
        { callSeq: 5, resultSeq: 6, exitCode: 1 },
        { callSeq: 10, resultSeq: 11, exitCode: 0 },
      ]
      : [{ callSeq: 10, resultSeq: 11, exitCode: 0 }],
    disallowedToolCallCount: 0,
    disallowedShellCommandCount: 0,
    outsideWorkspaceReferenceCount: 0,
    inputTokens: 1_000,
    outputTokens: 200,
    completionTextSha256: 'a'.repeat(64),
  }
}

function oracle(
  phase: LeonAcc008OracleRun['phase'],
  exitCode: number,
  sourceDigests: Readonly<Record<string, string>>,
): LeonAcc008OracleRun {
  return {
    phase,
    exitCode,
    durationMs: 10,
    stdoutSha256: 'b'.repeat(64),
    stderrSha256: 'c'.repeat(64),
    sourceDigests,
  }
}

function at(seq: number, type: string, data: Record<string, unknown>): unknown {
  return { seq, type, data }
}

function result(callId: string, text: string): Record<string, unknown> {
  return {
    message: {
      source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', content: [{ type: 'text', text }] }],
    },
  }
}
