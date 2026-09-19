import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import WebAccessService from '@deepseek-ai/dsh-web-access'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as ToolWeb from '../src/index.ts'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(options: {
  approval?: 'ask' | 'never' | 'missing'
  egressPolicy?: 'ask' | 'allow'
  webAccess?: boolean
  answer?: (request: ApprovalRequest) => Promise<ApprovalOutcome>
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  if (options.approval !== 'missing') await ctx.plugin(ApprovalService, { policy: options.approval ?? 'ask' })
  if (options.webAccess) await ctx.plugin(WebAccessService)
  if (options.answer) ctx.on('approval/request', options.answer)
  const search = vi.fn(async () => ({ sources: [], truncated: false }))
  const fetch = vi.fn(async () => ({ url: 'https://example.test/', statusCode: 200, body: { kind: 'text' as const, content: 'fixture' }, truncated: false }))
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, search })
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, fetch })
  const fiber = await ctx.plugin(ToolWeb, { egressPolicy: options.egressPolicy ?? 'ask' })
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  // Only the identity and real session are used by the executor and approval service.
  const agent = { id: session.id, session } as Agent
  let sequence = 0
  const call = (name: string, args: unknown, signal = new AbortController().signal, withAgent = true) => ctx.tools.execute({
    callId: CallId(`web-${++sequence}`), name, arguments: args, signal,
    ...withAgent ? { agent } : {},
  })
  return { ctx, call, search, fetch, session, fiber }
}

const calls = [
  { name: 'web_search', args: { queries: ['PRIVATE_CANARY_2026', 'public topic'] } },
  { name: 'web_fetch', args: { url: 'https://example.test/?private=PRIVATE_CANARY_2026' } },
]

describe.each(calls)('$name outbound approval', ({ name, args }) => {
  it.each(['rejected', 'cancelled', 'unavailable'] as const)('does not contact any provider when %s', async (outcome) => {
    const test = await setup({ answer: async () => outcome })
    const result = await test.call(name, args)
    expect(result.error?.info?.code).toBe('WEB_APPROVAL_DENIED')
    expect(test.search).not.toHaveBeenCalled()
    expect(test.fetch).not.toHaveBeenCalled()
    const asked = test.session.events.find(event => event.type === 'approval/asked')
    const decided = test.session.events.find(event => event.type === 'approval/decided')
    expect(asked?.data).toMatchObject({ callId: 'web-1', toolName: name })
    expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome })
    expect(asked?.data.reason).toContain(JSON.stringify(args, null, 2))
  })

  it('fails closed without an approval service or an owning agent', async () => {
    for (const approval of ['missing', 'ask'] as const) {
      const test = await setup({ approval })
      const result = await test.call(name, args, undefined, approval === 'missing')
      expect(result.error?.info?.code).toBe('WEB_APPROVAL_REQUIRED')
      expect(test.search).not.toHaveBeenCalled()
      expect(test.fetch).not.toHaveBeenCalled()
    }
  })

  it('does not reuse one grant for a repeated call or accept a generic pre-execute allow as consent', async () => {
    const answer = vi.fn<(_: ApprovalRequest) => Promise<ApprovalOutcome>>()
      .mockResolvedValueOnce('allowed-once').mockResolvedValueOnce('rejected')
    const test = await setup({ answer })
    test.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' as const }))
    expect((await test.call(name, args)).isError).toBe(false)
    expect((await test.call(name, args)).isError).toBe(true)
    expect(answer).toHaveBeenCalledTimes(2)
    expect(name === 'web_search' ? test.search : test.fetch).toHaveBeenCalledTimes(name === 'web_search' ? 2 : 1)
  })

  it('blocks when prompts are disabled and when no answerer is available', async () => {
    const answer = vi.fn(async (): Promise<ApprovalOutcome> => 'allowed-once')
    const never = await setup({ approval: 'never', answer })
    expect((await never.call(name, args)).isError).toBe(true)
    expect(answer).not.toHaveBeenCalled()
    expect(never.search).not.toHaveBeenCalled()
    expect(never.fetch).not.toHaveBeenCalled()
    const unavailable = await setup()
    expect((await unavailable.call(name, args)).error?.info?.code).toBe('WEB_APPROVAL_DENIED')
    expect(unavailable.search).not.toHaveBeenCalled()
    expect(unavailable.fetch).not.toHaveBeenCalled()
  })

  it('withdraws pending consent on cancellation and ignores a late grant', async () => {
    const controller = new AbortController()
    const pending = Promise.withResolvers<ApprovalOutcome>()
    const requested = Promise.withResolvers<undefined>()
    const test = await setup({ answer: () => { requested.resolve(undefined); return pending.promise } })
    const result = test.call(name, args, controller.signal)
    await requested.promise
    controller.abort()
    expect((await result).isError).toBe(true)
    pending.resolve('allowed-once')
    await Promise.resolve()
    expect(test.search).not.toHaveBeenCalled()
    expect(test.fetch).not.toHaveBeenCalled()
  })

  it('keeps overlapping callers on distinct one-shot decisions', async () => {
    const answers = [Promise.withResolvers<ApprovalOutcome>(), Promise.withResolvers<ApprovalOutcome>()]
    const bothAsked = Promise.withResolvers<undefined>()
    let count = 0
    const test = await setup({ answer: () => {
      const pending = answers[count++]!
      if (count === 2) bothAsked.resolve(undefined)
      return pending.promise
    } })
    const first = test.call(name, args)
    const second = test.call(name, args)
    await bothAsked.promise
    answers[1]!.resolve('rejected')
    answers[0]!.resolve('allowed-once')
    expect((await first).isError).toBe(false)
    expect((await second).isError).toBe(true)
    expect(name === 'web_search' ? test.search : test.fetch).toHaveBeenCalledTimes(name === 'web_search' ? 2 : 1)
    const asks = test.session.events.filter(event => event.type === 'approval/asked')
    expect(new Set(asks.map(event => event.data.id)).size).toBe(2)
  })

  it('lets an explicit session grant bypass ask and restores the block immediately when revoked', async () => {
    const test = await setup({ approval: 'never', webAccess: true })
    const provider = name === 'web_search' ? test.search : test.fetch
    const expectedProviderCalls = name === 'web_search' ? 2 : 1
    expect((await test.call(name, args)).error?.info?.code).toBe('WEB_APPROVAL_DENIED')
    expect(provider).not.toHaveBeenCalled()
    const approvalEventsBeforeGrant = test.session.events.filter(event => event.type === 'approval/asked').length

    expect(test.ctx.webAccess.set(test.session, true)).toBe(true)
    expect((await test.call(name, args)).isError).toBe(false)
    expect(provider).toHaveBeenCalledTimes(expectedProviderCalls)
    expect(test.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(approvalEventsBeforeGrant)

    expect(test.ctx.webAccess.set(test.session, false)).toBe(true)
    expect((await test.call(name, args)).error?.info?.code).toBe('WEB_APPROVAL_DENIED')
    expect(provider).toHaveBeenCalledTimes(expectedProviderCalls)
  })

  it('preserves explicit allow mode without an approval service', async () => {
    const test = await setup({ approval: 'missing', egressPolicy: 'allow' })
    expect((await test.call(name, args, undefined, false)).isError).toBe(false)
    expect(test.session.events.some(event => event.type === 'approval/asked')).toBe(false)
  })
})

it('validates queries before asking and unregisters guarded tools on disposal', async () => {
  const answer = vi.fn(async (): Promise<ApprovalOutcome> => 'allowed-once')
  const test = await setup({ answer })
  expect((await test.call('web_search', { queries: [' '] })).isError).toBe(true)
  expect(answer).not.toHaveBeenCalled()
  await test.fiber.dispose()
  expect(test.ctx.tools.schemas()).toEqual([])
})

it('keeps the Leon preset on explicit per-call outbound approval', () => {
  const preset = readFileSync(new URL('../../../../apps/cli/config/agent-presets/leon/agent.cordis.yml', import.meta.url), 'utf8')
  expect(preset).toMatch(/- id: tool-web\s+name: '@deepseek-ai\/dsh-tool-web'\s+config:\s+egressPolicy: ask/)
})

it('times out a pending question without dispatch and keeps guarded scheduling exclusive', async () => {
  const pending = Promise.withResolvers<ApprovalOutcome>()
  const test = await setup({ answer: () => pending.promise })
  await test.fiber.dispose()
  await test.ctx.plugin(TimeoutPolicy)
  await test.ctx.plugin(ToolWeb, { egressPolicy: 'ask', fetchTimeoutMs: 25 })
  expect(test.ctx.tools.executionMode({
    callId: CallId('schedule'), name: 'web_fetch', arguments: calls[1]!.args, signal: new AbortController().signal,
  })).toEqual({ kind: 'exclusive' })
  const result = await test.call('web_fetch', calls[1]!.args)
  expect(result.error?.info?.code).toBe('TOOL_TIMEOUT')
  pending.resolve('allowed-once')
  await Promise.resolve()
  expect(test.fetch).not.toHaveBeenCalled()
})
