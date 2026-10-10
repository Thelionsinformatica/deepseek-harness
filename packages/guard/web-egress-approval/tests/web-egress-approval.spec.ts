/**
 * The web egress guard over the real registry and approval service: listed web
 * tools run only after a one-shot grant whose prompt shows the full arguments,
 * every other outcome denies before the tool body runs, and unrelated tools or
 * earlier denials pass through untouched.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, { defineContentToolFixture, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as guard from '@deepseek-ai/dsh-web-egress-approval'
import WebAccessService from '@deepseek-ai/dsh-web-access'

function fakeAgent(): Agent {
  const session = Session.create(SessionId('web-egress-agent'))
  session.append('turn/start', { turn: 1 })
  return { session } as Agent
}

/** A web-shaped tool fixture that records whether its body ran. */
function webTool(name: string, ran: string[]) {
  return defineContentToolFixture({
    name, description: name, parameters: {},
    execute(args) {
      ran.push(name)
      return Promise.resolve([{ type: 'text' as const, text: JSON.stringify(args) }])
    },
  })
}

async function setup(options: { approval?: boolean; config?: Partial<guard.Config> } = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.approval !== false) await ctx.plugin(ApprovalService)
  await ctx.plugin(guard, guard.Config({ ...DEFAULTS, ...options.config }))
  const ran: string[] = []
  for (const name of ['web_search', 'web_fetch', 'read']) ctx.tools.register(webTool(name, ran))
  return { ctx, ran }
}

const signal = new AbortController().signal
const DEFAULTS: guard.Config = { tools: ['web_search', 'web_fetch'], maxArgumentChars: 8192 }

describe('web-egress-approval', () => {
  it('runs web_search only after a grant whose prompt carries the exact queries', async () => {
    const { ctx, ran } = await setup()
    const seen: ApprovalRequest[] = []
    ctx.on('approval/request', (req) => {
      seen.push(req)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const result = await ctx.tools.execute({
      callId: ToolCallId('s1'), name: 'web_search', arguments: { queries: ['cotação CPF 123'] }, agent: fakeAgent(), signal,
    })
    expect(result.isError).toBe(false)
    expect(ran).toEqual(['web_search'])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ toolName: 'web_search', callId: 's1' })
    expect(seen[0]?.reason).toContain('cotação CPF 123')
    expect(seen[0]?.displayReason?.['pt-BR']).toContain('provedor de pesquisa')
    expect(seen[0]?.displayReason?.['pt-BR']).toContain('cotação CPF 123')
  })

  it('shows the full URL for web_fetch and asks again on every call', async () => {
    const { ctx, ran } = await setup()
    const seen: ApprovalRequest[] = []
    ctx.on('approval/request', (req) => {
      seen.push(req)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const agent = fakeAgent()
    for (const id of ['f1', 'f2']) {
      await ctx.tools.execute({ callId: ToolCallId(id), name: 'web_fetch', arguments: { url: 'https://example.com/?token=abc' }, agent, signal })
    }
    expect(ran).toEqual(['web_fetch', 'web_fetch'])
    expect(seen.map(req => req.callId)).toEqual(['f1', 'f2'])
    expect(seen[0]?.reason).toContain('https://example.com/?token=abc')
  })

  it.each<ApprovalOutcome>(['rejected', 'cancelled', 'unavailable'])('denies before the tool body runs on %s', async (outcome) => {
    const { ctx, ran } = await setup()
    ctx.on('approval/request', () => Promise.resolve(outcome))
    const result = await ctx.tools.execute({ callId: ToolCallId('d1'), name: 'web_search', arguments: { queries: ['x'] }, agent: fakeAgent(), signal })
    expect(result.isError).toBe(true)
    expect(ran).toEqual([])
  })

  it('fails closed without an approval service or without an agent', async () => {
    const without = await setup({ approval: false })
    const a = await without.ctx.tools.execute({ callId: ToolCallId('n1'), name: 'web_fetch', arguments: { url: 'https://example.com' }, agent: fakeAgent(), signal })
    expect(a.isError).toBe(true)
    expect(without.ran).toEqual([])

    const agentless = await setup()
    const b = await agentless.ctx.tools.execute({ callId: ToolCallId('n2'), name: 'web_search', arguments: { queries: ['x'] }, signal })
    expect(b.isError).toBe(true)
    expect(agentless.ran).toEqual([])
  })

  it('leaves unlisted tools alone and keeps an earlier denial', async () => {
    const { ctx, ran } = await setup()
    let asked = 0
    ctx.on('approval/request', () => {
      asked++
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const read = await ctx.tools.execute({ callId: ToolCallId('r1'), name: 'read', arguments: {}, agent: fakeAgent(), signal })
    expect(read.isError).toBe(false)

    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> =>
      exec.name === 'web_search' ? { kind: 'deny', reason: 'blocked by target policy' } : next())
    const denied = await ctx.tools.execute({ callId: ToolCallId('r2'), name: 'web_search', arguments: {}, agent: fakeAgent(), signal })
    expect(denied.content[0]).toMatchObject({ text: 'Error: blocked by target policy' })
    expect(ran).toEqual(['read'])
    expect(asked).toBe(0)
  })

  it('skips the ask when the user switched web access on for the session', async () => {
    const { ctx, ran } = await setup()
    await ctx.plugin(WebAccessService)
    let asked = 0
    ctx.on('approval/request', () => {
      asked++
      return Promise.resolve<ApprovalOutcome>('rejected')
    })
    const session = ctx.sessions.create(SessionId('web-egress-granted'))
    session.append('turn/start', { turn: 1 })
    const agent = { session } as Agent
    ctx.webAccess.set(session, true)
    const granted = await ctx.tools.execute({ callId: ToolCallId('g1'), name: 'web_search', arguments: { queries: ['x'] }, agent, signal })
    expect(granted.isError).toBe(false)
    ctx.webAccess.set(session, false)
    const asking = await ctx.tools.execute({ callId: ToolCallId('g2'), name: 'web_search', arguments: { queries: ['x'] }, agent, signal })
    expect(asking.isError).toBe(true)
    expect(ran).toEqual(['web_search'])
    expect(asked).toBe(1)
  })

  it('bounds the arguments shown in the prompt', () => {
    const ask = guard.egressAsk(
      { name: 'web_fetch', arguments: { url: `https://example.com/${'a'.repeat(1000)}` } },
      guard.Config({ ...DEFAULTS, maxArgumentChars: 256 }),
    )
    expect(ask.reason).toContain('truncated')
    expect(ask.reason?.length).toBeLessThan(600)
  })
})
