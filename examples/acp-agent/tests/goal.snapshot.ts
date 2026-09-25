import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionSnapshot,
  normalizeStdout,
  runScenario,
  type AgentUnderTest,
  type InputScript,
  type NormalizeContext,
} from '@deepseek-ai/dsh-acp-snapshot'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

// This lifecycle proof has goal-specific timestamp normalization and semantic
// assertions, so it owns a separate snapshot root from the generic suite.
const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots/goal-round-driver')
const fixtureFile = join(scenarioDir, 'session.jsonl')
const overrideFile = join(scenarioDir, 'replay.override.json')
const stdoutExpected = join(scenarioDir, 'stdout.expected.jsonl')
const sessionExpected = join(scenarioDir, 'session.expected.jsonl')
const wrapupDir = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots/goal-wrapup')
const autoStartDir = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots/goal-auto-start')
const autoStartConfig = fileURLToPath(new URL('../goal-auto-start.cordis.yml', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

const agent: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}

interface JsonObject {
  [key: string]: unknown
}

/** Parse non-empty records from one JSONL artifact. */
function parseJsonl(content: string): JsonObject[] {
  return content.split('\n').filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

/** Zero durable goal timestamps and run-varying evidence digests inside metadata records and rendered XML JSON. */
function normalizeGoalTimestamps(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/(Host-captured parent execution trace \(JSON\):\n)([^\n]+)/g, (_match, prefix: string, json: string) => {
        const trace = JSON.parse(json) as JsonObject
        const parent = trace.scope === 'parent-and-direct-children' ? trace.parent as JsonObject : trace
        if (!Array.isArray(parent.events)) return prefix + json
        const normalized = { ...parent, digest: '<digest>', events: (parent.events as JsonObject[]).map(event => ({ ...event, time: 0 })) }
        return prefix + JSON.stringify(trace.scope === 'parent-and-direct-children' ? { ...trace, parent: normalized } : normalized)
      })
      .replace(/("(?:createdAt|updatedAt|clearedAt|auditedAt)":)\d+/g, '$10')
      // The evidence digest hashes raw session events (real ids and times), so
      // it changes every run; the auditor verdict digest stays stable.
      .replace(/("evidence":\{[^{}]*"digest":")[0-9a-f]{64}(")/g, '$1<digest>$2')
  }
  if (Array.isArray(value)) return value.map(normalizeGoalTimestamps)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      ['createdAt', 'updatedAt', 'clearedAt', 'auditedAt'].includes(key) && typeof item === 'number'
        ? 0
        : key === 'digest' && typeof item === 'string' && 'fromSeq' in value
          ? '<digest>'
          : normalizeGoalTimestamps(item),
    ]))
  }
  return value
}

/** Normalize one persisted goal log after the shared snapshot scrubbers. */
function normalizeGoalLog(content: string, context: NormalizeContext): string {
  return parseJsonl(normalizeSessionSnapshot(content, context))
    .map(record => JSON.stringify(normalizeGoalTimestamps(record))).join('\n') + '\n'
}

describe('same-session goal snapshot through the ACP automation driver', () => {
  it('runs exact automatic rounds in the shipped application and persists cancellation', async () => {
    const input = JSON.parse(await readFile(join(scenarioDir, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent,
      mode: 'replay',
      fixtureFile,
      overrideFile,
      configPath: agent.configPath,
    })

    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(1)
    const log = result.sessionLogs[0]
    if (log === undefined) throw new Error('goal snapshot did not persist its session')
    const records = parseJsonl(log.content)
    const events = records.slice(1) as unknown as SessionEvent[]
    const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['create_goal', 'get_goal'])
    const rounds = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
      && event.data.source.round > 0
      ? [event.data.source.round]
      : [])
    expect(rounds).toEqual([1, 2])
    expect(events.some(event => event.type === 'turn/end'
      && event.data.turn === 2 && event.data.reason.kind === 'max-tokens')).toBe(true)
    expect(foldGoal(events)).toMatchObject({
      goal: {
        objective: 'Finish the ACP goal-round-driver snapshot proof',
        phase: 'paused',
        revision: 2,
        maxGoalRounds: 2,
      },
      roundsStarted: 2,
    })

    const context: NormalizeContext = {
      sessionIds: [result.sessionId, log.id].filter((id): id is string => id !== undefined),
      cwd: result.cwd,
    }
    const stdout = normalizeStdout(result.rawStdout, context)
    const session = normalizeGoalLog(log.content, context)
    if (refreshing) {
      await Promise.all([
        writeFile(stdoutExpected, stdout),
        writeFile(sessionExpected, session),
      ])
    }
    expect(stdout).toBe(await readFile(stdoutExpected, 'utf8'))
    expect(session).toBe(await readFile(sessionExpected, 'utf8'))
  })

  it('injects the wrap-up instruction after an autonomous completion and delivers a closing message', async () => {
    const input = JSON.parse(await readFile(join(wrapupDir, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent,
      mode: 'replay',
      fixtureFile: join(wrapupDir, 'session.jsonl'),
      overrideFile: join(wrapupDir, 'replay.override.json'),
      configPath: agent.configPath,
    })

    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(1)
    const log = result.sessionLogs[0]
    if (log === undefined) throw new Error('goal wrap-up snapshot did not persist its session')
    const records = parseJsonl(log.content)
    const events = records.slice(1) as unknown as SessionEvent[]
    const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['create_goal', 'update_goal'])
    expect(foldGoal(events)).toMatchObject({
      goal: {
        objective: 'Finish the ACP goal wrap-up snapshot proof',
        phase: 'complete',
        revision: 2,
      },
      roundsStarted: 1,
    })
    // The wrap-up instruction is one plugin-sourced context injected after the
    // terminal tool result, and the model still answers inside the same turn.
    const wrapups = events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'tool-goal')
    expect(wrapups).toHaveLength(1)
    const wrapupText = wrapups.map(event => event.type === 'user/message' ? event.data.content : [])[0]
    expect(JSON.stringify(wrapupText)).toContain('<goal_complete>')
    const closing = events.filter(event => event.type === 'assistant/message')
      .flatMap(event => event.data.message.content)
      .filter(block => block.type === 'text' && block.text.startsWith('GOAL WRAP-UP'))
    expect(closing).toHaveLength(1)
    const roundTurnEnds = events.filter(event => event.type === 'turn/end' && event.data.turn === 2)
    expect(roundTurnEnds).toHaveLength(1)
    expect(roundTurnEnds[0]?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })

    const context: NormalizeContext = {
      sessionIds: [result.sessionId, log.id].filter((id): id is string => id !== undefined),
      cwd: result.cwd,
    }
    const stdout = normalizeStdout(result.rawStdout, context)
    const session = normalizeGoalLog(log.content, context)
    const wrapupStdoutExpected = join(wrapupDir, 'stdout.expected.jsonl')
    const wrapupSessionExpected = join(wrapupDir, 'session.expected.jsonl')
    if (refreshing) {
      await Promise.all([
        writeFile(wrapupStdoutExpected, stdout),
        writeFile(wrapupSessionExpected, session),
      ])
    }
    expect(stdout).toBe(await readFile(wrapupStdoutExpected, 'utf8'))
    expect(session).toBe(await readFile(wrapupSessionExpected, 'utf8'))
  })

  it('auto-admits implementation work and continues without a model create_goal call', async () => {
    const input = JSON.parse(await readFile(join(autoStartDir, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent,
      mode: 'replay',
      fixtureFile: join(autoStartDir, 'session.jsonl'),
      childFiles: [join(autoStartDir, 'session.1.jsonl')],
      overrideFile: join(autoStartDir, 'replay.override.json'),
      configPath: autoStartConfig,
    })

    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(2)
    const log = result.sessionLogs.find(item => item.id === result.sessionId)
    if (log === undefined) throw new Error('automatic goal snapshot did not persist its session')
    const auditLog = result.sessionLogs.find(item => item.id !== result.sessionId)
    if (auditLog === undefined) throw new Error('automatic goal snapshot did not persist its audit child')
    const records = parseJsonl(log.content)
    const events = records.slice(1) as unknown as SessionEvent[]
    const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['todo_write', 'todo_write', 'update_goal', 'todo_write', 'update_goal'])
    const receipt = events.find(event => event.type === 'goal/completion-audit')!
    expect(events.filter(event => event.type === 'goal/completion-audit')).toHaveLength(1)
    expect(events.slice(0, receipt.seq).findLast(event => event.type === 'todo/write')?.data.todos.at(-1)?.status)
      .toBe('in_progress')
    expect(events.slice(receipt.seq + 1).find(event => event.type === 'todo/write')?.data.todos.at(-1)?.status)
      .toBe('completed')
    const rounds = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
      && event.data.source.round > 0
      ? [event.data.source.round]
      : [])
    expect(rounds).toEqual([1])
    expect(foldGoal(events)).toMatchObject({
      goal: {
        objective: 'Implement and validate a small project from start to finish.',
        phase: 'complete',
        revision: 2,
        maxGoalRounds: 3,
      },
      roundsStarted: 1,
    })
    const auditRecords = parseJsonl(auditLog.content)
    const auditEvents = auditRecords.slice(1) as unknown as SessionEvent[]
    const auditPrompt = auditEvents.filter(event => event.type === 'user/message')
      .flatMap(event => event.data.content)
      .filter(block => block.type === 'text')
      .map(block => block.text).find(text => text.includes('Host-captured parent execution trace (JSON):'))
    expect(auditPrompt).toBeDefined()
    const traceJson = auditPrompt!.split('Host-captured parent execution trace (JSON):\n')[1]!.split('\n')[0]!
    const bundle = JSON.parse(traceJson) as JsonObject
    const trace = bundle.parent as JsonObject
    expect(bundle.scope).toBe('parent-and-direct-children')
    const parentTools = events.filter(event => (event.type === 'tool/call' || event.type === 'tool/result')
      && event.seq <= (trace.throughSeq as number))
    expect(trace).toMatchObject({ scope: 'parent-session-only', complete: true, eventCount: parentTools.length })
    expect(trace.events).toEqual(parentTools)
    expect(trace.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(auditEvents.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['structured_output'])

    const context: NormalizeContext = {
      sessionIds: [result.sessionId, ...result.sessionLogs.map(item => item.id)]
        .filter((id): id is string => id !== undefined),
      cwd: result.cwd,
    }
    const stdout = normalizeStdout(result.rawStdout, context)
    const session = normalizeGoalLog(log.content, context)
    const auditSession = normalizeGoalLog(auditLog.content, context)
    const stdoutFile = join(autoStartDir, 'stdout.expected.jsonl')
    const sessionFile = join(autoStartDir, 'session.expected.jsonl')
    const auditSessionFile = join(autoStartDir, 'audit-session.expected.jsonl')
    if (refreshing) {
      await Promise.all([
        writeFile(stdoutFile, stdout),
        writeFile(sessionFile, session),
        writeFile(auditSessionFile, auditSession),
      ])
    }
    expect(stdout).toBe(await readFile(stdoutFile, 'utf8'))
    expect(session).toBe(await readFile(sessionFile, 'utf8'))
    expect(auditSession).toBe(await readFile(auditSessionFile, 'utf8'))
  })
})
