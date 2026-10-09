// Proves the independent completion review through a real cordis.yml: Loader
// config activates the policy, a structured fresh provider passes, and only
// then does the durable goal change reach complete.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
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

function liveAgent(ctx: Context, name = 'goal-audit-loader-agent', publish = true, cwd?: string): Agent {
  const id = SessionId(name)
  const session = cwd === undefined ? Session.create(id)
    : Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd })
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
  if (publish) ctx.agents.register(agent)
  const message = createUserMessage({ content: [{ type: 'text', text: 'implemente e valide' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', message)
  const admitted = agent.inbox.claim('next-turn', 1)
  session.append('turn/start', { turn: 1 })
  for (const item of admitted) session.append('user/message', item, { surfaceOp: 'append' })
  return agent
}

describe('tool-goal independent audit through real Loader composition', () => {
  it.each([
    { auxiliary: false, evidenceLimit: 24000 },
    { auxiliary: true, evidenceLimit: 24000 },
    { auxiliary: false, evidenceLimit: 1 },
    { auxiliary: false, evidenceLimit: 256, readPages: true },
    { auxiliary: false, evidenceLimit: 256, readPages: false },
    ...process.platform === 'win32' ? ['', 'secret.env', 'id_rsa'].map(artifactStream => ({
      auxiliary: false, evidenceLimit: 24000, artifactStream,
    })) : [],
  ])('routes or blocks the auditor with policy %j', async (policy) => {
    const { auxiliary, evidenceLimit } = policy
    const readPages = 'readPages' in policy ? policy.readPages : undefined
    const artifactStream = 'artifactStream' in policy ? policy.artifactStream : undefined
    root = await mkdtemp(join(tmpdir(), 'dsh-goal-audit-loader-'))
    const artifactPath = join(root, 'notas.txt') + (artifactStream ? `:${artifactStream}` : '')
    const artifactText = 'FICTITIOUS_ARTIFACT_ONLY'
    if (artifactStream !== undefined) {
      await writeFile(join(root, 'notas.txt'), 'FICTITIOUS_BASE_ONLY', { flag: 'wx' })
      await writeFile(artifactPath, artifactText)
      expect(await readFile(artifactPath, 'utf8')).toBe(artifactText)
    }
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      ...auxiliary ? [
        "- name: '@deepseek-ai/dsh-agent-default-model'",
        '  config:', '    provider: local', '    model: main',
        '    auxiliaryModels:', '      localProviders: [local]', '      roles:',
        '        review:', '          provider: local', '          model: reviewer-role',
      ] : [],
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-subagent'",
      "- name: 'test-auditor-provider'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      ...artifactStream === undefined ? [] : ["- name: '@deepseek-ai/dsh-fs-local'"],
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
      '    completionAuditorTools: [completion_evidence_read]',
      `    completionAuditorEvidenceMaxCharacters: ${evidenceLimit}`,
      ...artifactStream === undefined ? [] : ['    completionAuditorRequireArtifacts: true'],
      '',
    ].join('\n'))

    const requests: ResolvedSubagentStartRequest[] = []
    const artifactReads: { isError: boolean; content: string }[] = []
    let lastAuditor: Agent | undefined
    const auditor = {
      name: 'test-auditor-provider',
      inject: ['subagents', 'agents', 'tools'],
      apply(ctx: Context) {
        ctx.subagents.registerProvider({
          name: 'audit',
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true, setup: true },
          inheritsParentContext: false,
          async start(request) {
            requests.push(request)
            const child = liveAgent(ctx, 'paged-auditor', false, root)
            lastAuditor = child
            const scope = createScope(ctx, child)
            const childCtx = scope.ctx.extend({ agent: child })
            Object.defineProperty(child, 'ctx', { value: childCtx })
            await request.setup?.(childCtx)
            expect(request.toolFilter?.allow?.includes('completion_evidence_read')).toBe(evidenceLimit === 256)
            const unregister = ctx.agents.register(child)
            const result = async () => {
              if (evidenceLimit === 24000) {
                const unassigned = await ctx.agents.withInitiator(child, () => ctx.tools.execute({
                  signal: new AbortController().signal, callId: CallId('unassigned-page'),
                  name: 'completion_evidence_read', arguments: { page: 1 }, agent: child,
                }))
                expect(unassigned.isError).toBe(true)
              }
              if (artifactStream !== undefined) {
                const artifact = await ctx.agents.withInitiator(child, () => ctx.tools.execute({
                  signal: new AbortController().signal, callId: CallId('read-local-artifact'),
                  name: 'completion_artifact_read', arguments: { file_path: artifactPath }, agent: child,
                }))
                artifactReads.push({ isError: artifact.isError, content: JSON.stringify(artifact) })
              }
              if (readPages) {
                const text = request.prompt[0]
                if (text?.type !== 'text') throw new Error('missing evidence manifest')
                const manifest = JSON.parse(text.text.split('Host-captured parent execution trace (JSON):\n')[1]!.split('\n')[0]!) as { pages: number }
                for (let page = 1; page <= manifest.pages; page++) {
                  const evidence = await ctx.agents.withInitiator(child, () => ctx.tools.execute({
                    signal: new AbortController().signal, callId: CallId(`page-${page}`),
                    name: 'completion_evidence_read', arguments: { page }, agent: child,
                  }))
                  expect(evidence.isError).toBe(false)
                }
              }
              return { stopReason: 'completed' as const, output: [],
                structured: { status: 'pass', summary: 'validado', findings: [] } }
            }
            return {
              id: child.id,
              localAgent: child,
              result: result(),
              async dispose() { unregister(); await scope.dispose() },
            }
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
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
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

    if (artifactStream !== undefined) {
      expect(artifactReads).toHaveLength(1)
      expect(artifactReads[0]?.isError).toBe(artifactStream !== '')
      expect(artifactReads[0]?.content.includes(artifactText)).toBe(artifactStream === '')
    }

    if (artifactStream) {
      expect(result.isError).toBe(true)
      expect(ctx.goals.get(agent)?.phase).toBe('active')
      expect(agent.session.events.some(event => event.type === 'goal/completion-audit')).toBe(false)
      expect(await readFile(artifactPath, 'utf8')).toBe(artifactText)
      return
    }

    if (evidenceLimit === 1) {
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('GOAL_QUALITY_AUDIT_EVIDENCE_INCOMPLETE')
      expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', revision: 1 })
      expect(requests).toHaveLength(0)
      expect(agent.session.events.some(event => event.type === 'goal/completion-audit')).toBe(false)
      return
    }
    if (readPages === false) {
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('GOAL_QUALITY_AUDIT_EVIDENCE_INCOMPLETE')
      expect(ctx.goals.get(agent)?.phase).toBe('active')
      expect(agent.session.events.some(event => event.type === 'goal/completion-audit')).toBe(false)
      return
    }

    expect(result.isError).toBe(false)
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'complete', revision: 2 })
    expect(requests).toHaveLength(1)
    const prompt = requests[0]?.prompt[0]
    if (prompt?.type !== 'text') throw new Error('expected audit text')
    if (readPages) {
      expect(prompt.text).toContain('completion_evidence_read')
      const child = lastAuditor!
      const expired = await ctx.agents.withInitiator(child, () => ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId('expired-page'),
        name: 'completion_evidence_read', arguments: { page: 1 }, agent: child,
      }))
      expect(expired.error?.info?.code).toBe('GOAL_QUALITY_AUDIT_ACCESS_DENIED')
      return
    }
    expect(prompt.text).toContain('Host-captured parent execution trace (JSON):')
    expect(prompt.text).toContain('"sessionId":"goal-audit-loader-agent"')
    expect(prompt.text).toContain('"scope":"parent-session-only"')
    expect(prompt.text).toContain('"scope":"parent-and-direct-children"')
    expect(prompt.text).toContain('Do not use configuration as proof')
    expect(requests[0]?.agentOptions).toMatchObject(auxiliary
      ? { provider: 'local', model: 'reviewer-role', maxTokens: 2048 }
      : { provider: 'google', model: 'gemini-auditor', maxTokens: 2048 })
    expect(ctx.tools.get('update_goal')?.presentCall?.({
      goal_id: created.id, revision: created.revision, action: 'complete',
    })).toMatchObject({ title: 'Verify delivery' })
  }, 30_000)
})
