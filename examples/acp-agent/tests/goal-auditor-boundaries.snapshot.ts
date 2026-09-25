/** Real ACP replay of restricted auditor tools and artifact-bound acceptance. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionSnapshot, normalizeStdout, runScenario,
  type AgentUnderTest, type InputScript, type NormalizeContext,
} from '@deepseek-ai/dsh-acp-snapshot'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

const snapshots = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots')
const agent: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../goal-auditor-boundaries.cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const seed = 'Verified fixture evidence: total=300.\n'

interface RecordValue { [key: string]: unknown }

/** Decode complete persisted records, retaining their semantic values. */
function records(content: string): RecordValue[] {
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordValue)
}

/** Normalize volatile goal metadata while retaining all artifact hashes and claims. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value === 'string') {
    return value.replace(/(Host-captured parent execution trace \(JSON\):\n)([^\n]+)/g,
      (_match, prefix: string, json: string) => prefix + JSON.stringify(stable(JSON.parse(json))))
      .replace(/("(?:createdAt|updatedAt|clearedAt|auditedAt)":)\d+/g, '$10')
      .replace(/("evidence":\{[^{}]*"digest":")[0-9a-f]{64}(")/g, '$1<digest>$2')
  }
  if (value === null || typeof value !== 'object') return value
  const record = value as RecordValue
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key,
    ['time', 'createdAt', 'updatedAt', 'clearedAt', 'auditedAt'].includes(key) && typeof child === 'number'
      ? 0 : key === 'digest' && ('fromSeq' in record || record.scope === 'parent-session-only')
        ? '<digest>' : stable(child),
  ]))
}

/** Materialize a comparable JSONL transcript from the shared portable scrubbers. */
function sessionSnapshot(content: string, context: NormalizeContext): string {
  return records(normalizeSessionSnapshot(content, context)).map(record => JSON.stringify(stable(record))).join('\n') + '\n'
}

/** Collect the actual tool result rather than trusting a model's final response. */
function resultText(events: SessionEvent[], callId: string): string {
  const event = events.find(item => item.type === 'tool/result'
    && item.data.message.source.kind === 'tool' && item.data.message.source.callId === callId)
  expect(event, `missing result for ${callId}`).toBeDefined()
  return JSON.stringify(event)
}

describe('independent auditor boundaries through the real ACP application', () => {
  it.each([
    { scenario: 'auditor-restricted-tools', stale: false },
    { scenario: 'auditor-stale-artifact', stale: true },
  ])('persists the acceptance boundary for $scenario', async ({ scenario, stale }) => {
    const directory = join(snapshots, scenario)
    const input = JSON.parse(await readFile(join(directory, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent, mode: 'replay', configPath: agent.configPath,
      fixtureFile: join(directory, 'session.jsonl'),
      childFiles: [join(directory, 'session.1.jsonl')],
      overrideFile: join(directory, 'replay.override.json'),
      workspaceDir: join(directory, 'workspace'),
    })
    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(2)
    const parent = result.sessionLogs.find(log => log.id === result.sessionId)
    const child = result.sessionLogs.find(log => log.id !== result.sessionId)
    if (parent === undefined || child === undefined) throw new Error('missing persisted auditor sessions')
    const parentEvents = records(parent.content).slice(1) as unknown as SessionEvent[]
    const childEvents = records(child.content).slice(1) as unknown as SessionEvent[]
    const header = childEvents.find(event => event.type === 'request/header')
    if (header?.type !== 'request/header') throw new Error('missing actual auditor request header')
    expect(header.data.header.tools?.map(tool => tool.name).sort()).toEqual([
      'completion_artifact_read', 'completion_evidence_read', 'structured_output',
    ])
    expect(resultText(childEvents, 'auditor-read')).toContain(seed.trim())
    expect(resultText(childEvents, 'auditor-read')).not.toContain('Forbidden mutation.')
    const receipts = parentEvents.filter(event => event.type === 'goal/completion-audit')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.data).toMatchObject({ artifacts: { coverage: 'files-reviewed', files: [
      { requestedPath: 'evidence.txt', bytes: Buffer.byteLength(seed), sha256: createHash('sha256').update(seed).digest('hex') },
    ] } })
    if (stale) {
      expect(resultText(parentEvents, 'complete')).toContain('GOAL_QUALITY_AUDIT_ARTIFACT_STALE')
      expect(resultText(parentEvents, 'inspect')).toContain('active')
      expect(parentEvents.some(event => event.type === 'goal/change' && event.data.operation === 'complete')).toBe(false)
      expect(foldGoal(parentEvents).goal?.phase).toBe('paused')
    } else {
      expect(resultText(childEvents, 'forbidden-write')).toContain('"isError":true')
      expect(resultText(childEvents, 'forbidden-write')).toContain('completion auditor host policy denies this capability')
      expect(foldGoal(parentEvents).goal?.phase).toBe('complete')
      expect(parentEvents.filter(event => event.type === 'goal/change' && event.data.operation === 'complete')).toHaveLength(1)
    }
    const context: NormalizeContext = { sessionIds: result.sessionLogs.map(log => log.id), cwd: result.cwd }
    const outputs = [
      ['stdout.expected.jsonl', normalizeStdout(result.rawStdout, context)],
      ['session.expected.jsonl', sessionSnapshot(parent.content, context)],
      ['audit-session.expected.jsonl', sessionSnapshot(child.content, context)],
    ] as const
    for (const [filename, content] of outputs) {
      const path = join(directory, filename)
      if (refreshing) await writeFile(path, content)
      expect(content).toBe(await readFile(path, 'utf8'))
    }
  })
})
