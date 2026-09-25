import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function harness(script: ConstructorParameters<typeof MockAdapter>[0], both = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: both ? 'both' : 'native' } })
  let codeRuns = 0
  if (both) {
    ctx.provide('codeRuntime', {
      language: 'typescript', isolation: 'test',
      run: () => { codeRuns++; return Promise.resolve({ logs: [] }) },
    } as never)
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('host-setup-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter, codeRuns: () => codeRuns }
}

function request(parent: Agent, signal = new AbortController().signal) {
  return {
    parent, signal, prompt: [{ type: 'text' as const, text: 'Inspect without changes.' }],
    descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'test' }),
    outputSchema: {
      type: 'object' as const, properties: { ok: { type: 'boolean' as const } }, required: ['ok'],
    },
  }
}

describe('host-owned one-shot setup', () => {
  it('awaits host setup after structured composition but before publication and first inference', async () => {
    const { ctx, parent, adapter } = await harness([toolCallResponse('finish', 'structured_output', { ok: true })])
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let child: Agent | undefined
    const starting = startInProcessRun({
      ...request(parent),
      setup: async (childCtx) => {
        child = childCtx.agent
        if (child === undefined) throw new Error('expected unpublished child agent')
        expect(childCtx.tools.get('structured_output', child)).toBeDefined()
        expect(ctx.agents.get(child.id)).toBeUndefined()
        childCtx.systemPrompt.section({ name: 'host:verification', order: 195, text: 'Host setup completed.' })
        entered.resolve(undefined)
        await release.promise
      },
    }, {})
    await entered.promise
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.agents.get(child!.id)).toBeUndefined()
    release.resolve(undefined)
    const run = await starting
    await expect(run.result).resolves.toMatchObject({ structured: { ok: true }, stopReason: 'completed' })
    expect(JSON.stringify(adapter.requests[0])).toContain('Host setup completed.')
    expect(JSON.stringify(run.localAgent!.session.events)).not.toContain('"setup"')
    await run.dispose()
    expect(ctx.agents.get(run.id)).toBeUndefined()
  })

  it('rolls back rejected setup and its effects without publication or inference', async () => {
    const { ctx, parent, adapter } = await harness([])
    const published: string[] = []
    ctx.on('agent/created', ({ agent }) => { published.push(agent.id) })
    let released = false
    let child: Agent | undefined
    await expect(startInProcessRun({
      ...request(parent),
      setup: async (childCtx) => {
        child = childCtx.agent
        childCtx.effect(() => () => { released = true })
        await Promise.resolve()
        throw new Error('host denied unsafe composition')
      },
    }, {})).rejects.toThrow('host denied unsafe composition')
    expect(released).toBe(true)
    expect(published).toEqual([])
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.agents.get(child!.id)).toBeUndefined()
    expect(ctx.tools.get('structured_output', child)).toBeUndefined()
  })

  it('drains awaited setup when cancellation wins before publication', async () => {
    const { ctx, parent, adapter } = await harness([])
    const controller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let released = false
    let child: Agent | undefined
    const starting = startInProcessRun({
      ...request(parent, controller.signal),
      setup: async (childCtx) => {
        child = childCtx.agent
        childCtx.effect(() => () => { released = true })
        entered.resolve(undefined)
        await release.promise
      },
    }, {})
    const rejected = expect(starting).rejects.toThrow()
    await entered.promise
    controller.abort('test cancelled')
    expect(adapter.requests).toHaveLength(0)
    release.resolve(undefined)
    await rejected
    expect(released).toBe(true)
    expect(ctx.agents.get(child!.id)).toBeUndefined()
    expect(adapter.requests).toHaveLength(0)
  })

  it('guards scoped additions, code transport and nested dispatch without affecting the parent', async () => {
    const { ctx, parent, adapter, codeRuns } = await harness([
      toolCallResponse('direct', 'scoped_mutation', {}),
      toolCallResponse('code', 'run_code', { code: 'return 1', description: 'Attempt code execution' }),
      toolCallResponse('nested', 'approved_probe', {}),
      toolCallResponse('finish', 'structured_output', { ok: true }),
    ], true)
    let mutations = 0
    const tool = defineContentToolFixture({
      name: 'scoped_mutation', description: 'Test mutation', parameters: {},
      execute: () => { mutations++; return Promise.resolve([{ type: 'text', text: 'mutated' }]) },
    })
    parent.ctx.tools.register(tool)
    const run = await startInProcessRun({
      ...request(parent),
      toolFilter: { allow: [] },
      setup: (childCtx) => {
        const child = childCtx.agent
        if (child === undefined) throw new Error('expected unpublished child agent')
        childCtx.tools.register(tool)
        childCtx.tools.register(defineContentToolFixture({
          name: 'approved_probe', description: 'Host probe of nested dispatch', parameters: {},
          execute: async (_args, exec) => {
            const nested = await childCtx.tools.execute({
              callId: CallId('nested-mutation'), name: 'scoped_mutation', arguments: {},
              agent: child, parent: exec.token, signal: exec.signal,
            })
            expect(nested.isError).toBe(true)
            return [{ type: 'text', text: 'nested mutation denied' }]
          },
        }))
        childCtx.tools.guard(exec => ['structured_output', 'approved_probe'].includes(exec.name)
          ? undefined : 'host read-only policy denied this capability')
      },
    }, {})
    await expect(run.result).resolves.toMatchObject({ structured: { ok: true }, stopReason: 'completed' })
    expect(adapter.requests).toHaveLength(4)
    expect(mutations).toBe(0)
    expect(codeRuns()).toBe(0)
    const child = run.localAgent!
    await run.dispose()
    expect(ctx.tools.get('approved_probe', child)).toBeUndefined()
    const parentResult = await parent.ctx.tools.execute({
      callId: CallId('parent-mutation'), name: 'scoped_mutation', arguments: {}, agent: parent,
      signal: new AbortController().signal,
    })
    expect(parentResult.isError).toBe(false)
    expect(mutations).toBe(1)
  })
})
