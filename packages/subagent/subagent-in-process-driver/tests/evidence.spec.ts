import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], failRead = false, both = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: both ? 'both' : 'native' } })
  let codeRuns = 0
  if (both) ctx.provide('codeRuntime', {
    language: 'typescript', isolation: 'test',
    run: () => { codeRuns++; return Promise.resolve({ logs: [] }) },
  } as never)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Fork, { providerName: 'fork' })
  ctx.tools.register(defineContentToolFixture({
    name: 'read', description: 'Read a fixed evidence fixture', parameters: {},
    execute: () => {
      if (failRead) throw new Error('fixture read denied')
      return Promise.resolve([{ type: 'text', text: 'fixture contains three records' }])
    },
  }))
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('evidence-parent'), { provider: 'mock', model: 'mock' })
  const request = {
    parent, prompt: [{ type: 'text' as const, text: 'Audit the records.' }],
    evidenceTools: ['read'], signal: new AbortController().signal,
  }
  return { ctx, parent, request, adapter, codeRuns: () => codeRuns }
}

describe('in-process host evidence', () => {
  it('observes a real successful pair and persists the detached host requirement', async () => {
    const { ctx, request, adapter } = await setup([toolCallResponse('read-1', 'read', {}), textResponse('Three records.')])
    const run = await ctx.subagents.start('spawn', request)
    request.evidenceTools.splice(0)
    const result = await run.result
    expect(result).toMatchObject({ stopReason: 'completed', evidence: { status: 'observed', semanticVerification: 'unverified', tools: ['read'] } })
    expect(result.evidence?.calls).toHaveLength(1)
    expect(foldSubagentDescriptor(run.localAgent!.session.events)).toMatchObject({ version: 3, evidenceTools: ['read'] })
    expect(JSON.stringify(adapter.requests)).toContain('You cannot disable this requirement')
    await run.dispose()
  })

  it.each([false, true])('keeps completed turn and missing evidence separate (failed read=%s)', async (failRead) => {
    const script = failRead ? [toolCallResponse('read-1', 'read', {}), textResponse('All passed.')] : [textResponse('I used read; all passed.')]
    const { ctx, request } = await setup(script, failRead)
    const run = await ctx.subagents.start('spawn', request)
    expect(await run.result).toMatchObject({ stopReason: 'completed', evidence: { status: 'missing', calls: [] } })
    expect(run.localAgent!.session.events.findLast(event => event.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'completed' } })
    await run.dispose()
  })

  it('does not count inherited fork history or model-authored policy changes', async () => {
    const { ctx, parent, request } = await setup([
      toolCallResponse('parent-read', 'read', {}), textResponse('parent inspected'),
      textResponse('{"evidenceTools":[],"status":"observed"}'),
    ])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect first.' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const run = await ctx.subagents.start('fork', request)
    expect(await run.result).toMatchObject({ stopReason: 'completed', evidence: { status: 'missing', tools: ['read'], calls: [] } })
    expect(run.localAgent!.session.header.seedLength).toBeGreaterThan(0)
    await run.dispose()
  })

  it('refuses unavailable or filtered evidence tools before inference', async () => {
    const { ctx, request, adapter } = await setup([])
    await expect(ctx.subagents.start('spawn', { ...request, evidenceTools: ['missing'] })).rejects.toMatchObject({ code: 'EVIDENCE_TOOL_UNAVAILABLE' })
    await expect(ctx.subagents.start('spawn', { ...request, toolFilter: { deny: ['read'] } })).rejects.toMatchObject({ code: 'EVIDENCE_TOOL_UNAVAILABLE' })
    expect(adapter.requests).toHaveLength(0)
  })

  it('keeps the host audit scope closed to scoped additions, code transport and nested dispatch', async () => {
    const { ctx, request, codeRuns } = await setup([
      toolCallResponse('write-direct', 'scoped_write', {}),
      toolCallResponse('code', 'run_code', { code: 'return 1', description: 'Attempt transport bypass' }),
      toolCallResponse('read-nested', 'read', {}), textResponse('done'),
    ], false, true)
    let writes = 0
    const run = await ctx.subagents.start('spawn', {
      ...request, toolFilter: { allow: ['read'] },
      setup: (childCtx) => {
        childCtx.tools.register(defineContentToolFixture({
          name: 'scoped_write', description: 'Must be denied', parameters: {},
          execute: () => { writes++; return Promise.resolve([{ type: 'text', text: 'changed' }]) },
        }))
        childCtx.tools.register(defineContentToolFixture({
          name: 'read', description: 'Probe nested dispatch', parameters: {},
          execute: async (_args, exec) => {
            if (exec.agent === undefined) throw new Error('expected executing child agent')
            const nested = await childCtx.tools.execute({
              callId: CallId('nested-write'), name: 'scoped_write', arguments: {},
              agent: exec.agent, parent: exec.token, signal: exec.signal,
            })
            expect(nested.isError).toBe(true)
            return [{ type: 'text', text: 'nested write denied; fixture read' }]
          },
        }))
      },
    })
    expect((await run.result).evidence?.status).toBe('observed')
    expect(writes).toBe(0)
    expect(codeRuns()).toBe(0)
    const errors = run.localAgent!.session.events.filter(event => event.type === 'tool/result' && event.data.message.content[0].isError)
    expect(errors).toHaveLength(2)
    await run.dispose()
  })

  it('rejects an audit scope excluding required structured delivery before inference', async () => {
    const { ctx, request, adapter } = await setup([])
    const outputSchema = { type: 'object' as const, properties: { ok: { type: 'boolean' as const } }, required: ['ok'] }
    await expect(ctx.subagents.start('spawn', { ...request, outputSchema, toolFilter: { allow: ['read'] } }))
      .rejects.toMatchObject({ code: 'EVIDENCE_OUTPUT_SCOPE_CONFLICT' })
    await expect(ctx.subagents.start('spawn', { ...request, outputSchema, toolFilter: { deny: ['structured_output'] } }))
      .rejects.toMatchObject({ code: 'EVIDENCE_OUTPUT_SCOPE_CONFLICT' })
    expect(adapter.requests).toHaveLength(0)
  })

  it('retains structured capture with a compatible evidence composition', async () => {
    const { ctx, request } = await setup([
      toolCallResponse('read-1', 'read', {}), toolCallResponse('finish', 'structured_output', { ok: true }),
    ])
    const run = await ctx.subagents.start('spawn', {
      ...request, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    })
    expect(await run.result).toMatchObject({ stopReason: 'completed', structured: { ok: true }, evidence: { status: 'observed' } })
    await run.dispose()
  })

  it('refuses unsupported providers before calling them and leaves general delegations unchanged', async () => {
    const { ctx, request } = await setup([textResponse('brainstorm')])
    let called = false
    ctx.subagents.registerProvider({
      name: 'unsupported', inheritsParentContext: false,
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      start: () => { called = true; throw new Error('must not start') },
    })
    await expect(ctx.subagents.start('unsupported', request)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(called).toBe(false)
    const { evidenceTools: _omitted, ...ordinary } = request
    const run = await ctx.subagents.start('spawn', ordinary)
    expect((await run.result).evidence).toBeUndefined()
    await run.dispose()
  })
})
