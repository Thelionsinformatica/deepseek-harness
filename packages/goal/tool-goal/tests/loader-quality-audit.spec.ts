// Proves the independent completion review through a real cordis.yml: Loader
// config activates the policy, a structured fresh provider passes, and only
// then does the durable goal change reach complete.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GoalService from '@deepseek-ai/dsh-goal'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function liveAgent(ctx: Context): Agent {
  const id = SessionId('goal-audit-loader-agent')
  const session = Session.create(id)
  const agent: Agent = {
    id,
    options: { provider: 'ollama', model: 'small-local' },
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx,
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  const message = createUserMessage({ content: [{ type: 'text', text: 'implemente e valide' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', message)
  const admitted = agent.inbox.claim('next-turn', 1)
  session.append('turn/start', { turn: 1 })
  for (const item of admitted) session.append('user/message', item, { surfaceOp: 'append' })
  return agent
}

describe('tool-goal independent audit through real Loader composition', () => {
  it('routes the fresh auditor to the configured model before committing completion', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-goal-audit-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-subagent'",
      "- name: 'test-auditor-provider'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-goal'",
      "- name: '@deepseek-ai/dsh-tool-goal'",
      '  config:',
      '    blockedAfterConsecutiveRounds: 3',
      '    completionRequiresCompletedTodos: true',
      '    completionAuditorProvider: audit',
      '    completionAuditorModelProvider: google',
      '    completionAuditorModel: gemini-auditor',
      '    completionAuditorMaxTokens: 2048',
      '    completionAuditorMaxAttemptsPerTurn: 2',
      '    completionAuditorReportMaxCharacters: 2000',
      '',
    ].join('\n'))

    const requests: ResolvedSubagentStartRequest[] = []
    const auditor = {
      name: 'test-auditor-provider',
      inject: ['subagents'],
      apply(ctx: Context) {
        ctx.subagents.registerProvider({
          name: 'audit',
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
          inheritsParentContext: false,
          start(request) {
            requests.push(request)
            return Promise.resolve({
              id: SessionId('loader-auditor-child'),
              localAgent: undefined,
              result: Promise.resolve({
                stopReason: 'completed' as const,
                output: [],
                structured: { status: 'pass', summary: 'validado', findings: [] },
              }),
              dispose: () => Promise.resolve(),
            })
          },
        })
      },
    }

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['test-auditor-provider', auditor],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-goal', GoalService],
      ['@deepseek-ai/dsh-tool-goal', ToolGoal],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const agent = liveAgent(ctx)
    const created = ctx.goals.create(agent, { objective: 'entregar a aplicação validada' })
    agent.session.append('todo/write', { todos: [{ content: 'validar aplicação', status: 'completed' }] })
    const run = () => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('complete-with-audit'),
      name: 'update_goal',
      arguments: { goal_id: created.id, revision: created.revision, action: 'complete' },
      agent,
    })
    const result = await ctx.agents.withInitiator(agent, run)

    expect(result.isError).toBe(false)
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'complete', revision: 2 })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.agentOptions).toMatchObject({ provider: 'google', model: 'gemini-auditor' })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: created.id, revision: created.revision, action: 'complete',
    })).toMatchObject({ title: 'Verify delivery' })
  }, 30_000)
})
