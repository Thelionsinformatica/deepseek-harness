/** Completion feedback and evidence availability through the real Loader, loop and persisted child. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as AgentSpine from '@deepseek-ai/dsh-agent-spine-demo'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { decodeStorageRecord, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.unstubAllEnvs()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('goal review feedback snapshot', () => {
  it('hides unassigned pages and requires an explicit status-only checklist update after PASS', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-goal-feedback-'))
    const fixtureRoot = root
    vi.stubEnv('DSH_GOAL_FEEDBACK_FIXTURE_ROOT', join(root, 'sessions'))
    await writeFile(join(root, 'result.txt'), 'VERIFIED SYNTHETIC RESULT\n', { flag: 'wx' })
    ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent-spine-demo', AgentSpine],
      ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-goal', GoalService],
      ['@deepseek-ai/dsh-tool-goal', ToolGoal],
      ['@deepseek-ai/dsh-tool-todo', ToolTodo],
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['@deepseek-ai/dsh-subagent-spawn-in-process', Spawn],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected module: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: {
      path: new URL('../goal-review-feedback.cordis.snapshot.yml', import.meta.url).href,
    } })
    await ctx.loader.await()
    const handle = await ctx.agents.create({
      sessionId: SessionId('goal-review-feedback-parent'), meta: { cwd: root },
      agentOptions: { provider: 'fixture-parent', model: 'coordinator' },
    })
    const goal = ctx.goals.create(handle.agent, { objective: 'Verify result.txt and complete its review checklist.' })
    const ref = { goal_id: goal.id, revision: goal.revision }
    const todos = [
      { content: 'Produce result.txt', status: 'completed' },
      { content: 'Independent review', status: 'in_progress' },
    ]
    const reviewer = new MockAdapter([
      // A fabricated call must still fail even when absent from advertised schemas.
      toolCallResponse('unassigned-page', 'completion_evidence_read', { page: 1 }),
      toolCallResponse('read-artifact', 'completion_artifact_read', { file_path: 'result.txt' }),
      toolCallResponse('verdict', 'structured_output', { status: 'pass', summary: 'Artefato conferido.', findings: [] }),
    ])
    ctx.llm.registerAdapter(['fixture-reviewer'], reviewer)
    const parent = new MockAdapter([
      toolCallResponse('initial-list', 'todo_write', { todos }),
      toolCallResponse('review', 'update_goal', { ...ref, action: 'review' }),
      toolCallResponse('premature-complete', 'update_goal', { ...ref, action: 'complete' }),
      toolCallResponse('unchanged-complete', 'update_goal', { ...ref, action: 'complete' }),
      toolCallResponse('record-review', 'todo_write', { todos: todos.map(todo => ({ ...todo, status: 'completed' })) }),
      toolCallResponse('complete', 'update_goal', { ...ref, action: 'complete' }),
      textResponse('Review and checklist completed.'),
    ])
    ctx.llm.registerAdapter(['fixture-parent'], parent)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify this synthetic result.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(ctx.goals.get(handle.agent)?.phase).toBe('complete')
    expect(reviewer.requests).toHaveLength(3)
    expect(reviewer.requests[0]?.tools?.map(tool => tool.name)).not.toContain('completion_evidence_read')
    expect(JSON.stringify(reviewer.requests[1]?.messages)).toContain('denied')
    await handle.dispose()
    await ctx.fiber.dispose()
    ctx = undefined
    const files = (await readdir(join(root, 'sessions'), { recursive: true })).filter(file => file.endsWith('.jsonl'))
    const logs = await Promise.all(files.map(file => readFile(join(fixtureRoot, 'sessions', file), 'utf8')))
    const parentLog = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === 'goal-review-feedback-parent')!
    const events = parentLog.trim().split('\n').slice(1).flatMap(line => decodeStorageRecord(JSON.parse(line)))
    const normalized = events.flatMap<Record<string, unknown>>((event) => {
      if (event.type === 'todo/write') return [{ type: event.type, todos: event.data.todos }]
      if (event.type === 'goal/completion-audit') return [{ type: event.type, completedTodoCount: event.data.completedTodoCount }]
      if (event.type === 'goal/change') return [{ type: event.type, operation: event.data.operation }]
      if (event.type === 'tool/result' && event.data.error !== undefined) return [{ type: event.type, error: event.data.error }]
      return []
    })
    const observed = {
      auditorTools: reviewer.requests[0]?.tools?.map(tool => tool.name),
      inlineInstruction: JSON.stringify(reviewer.requests[0]?.messages).includes('No evidence pages are assigned'),
      nextActionDelivered: JSON.stringify(parent.requests[2]?.messages).includes('If review bookkeeping is pending, call todo_write'),
      retryCorrectionDelivered: JSON.stringify(parent.requests[3]?.messages).includes('Do not repeat complete with an unchanged list'),
      auditCount: events.filter(event => event.type === 'goal/completion-audit').length,
      transitions: normalized,
      artifact: await readFile(join(root, 'result.txt'), 'utf8'),
    }
    expect(observed.inlineInstruction).toBe(true)
    expect(observed.nextActionDelivered).toBe(true)
    expect(observed.retryCorrectionDelivered).toBe(true)
    expect(observed.auditCount).toBe(1)
    expect(observed).toMatchSnapshot()
  })
})
