import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type SessionId, type WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { MemoryCandidateId } from '@deepseek-ai/dsh-tool-memory/types'
import { MemoryReviewButton } from '../src/client/MemoryReviewButton.tsx'
import type { MemoryReviewInjected } from '../src/client/MemoryReviewButton.tsx'
import { WorkDashboard } from '../src/client/WorkDashboard.tsx'
import type { WorkDashboardInjected } from '../src/client/WorkDashboard.tsx'
import { apply, inject } from '../src/client/index.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const open = vi.fn()
  const startSession = vi.fn()
  const list = vi.fn((_request: unknown) => Promise.resolve({
    ok: true as const,
    value: { items: [], hasMore: false, nextOffset: 0 },
  }))
  const markReviewed = vi.fn((request: { id: MemoryCandidateId; decision: 'accept' | 'ignore' | 'reject' }) => Promise.resolve({
    ok: true as const,
    value: {
      item: {
        id: request.id,
        sessionId: 'session-one' as SessionId,
        operation: 'message_candidate' as const,
        candidateContent: 'Prefere respostas diretas.',
        category: 'preference' as const,
        confidence: 0.94,
        sensitivity: 'none' as const,
        policyVersion: 1 as const,
        policyDecision: 'store' as const,
        policyReason: 'high-confidence' as const,
        reviewed: true,
        reviewDecision: request.decision,
        reviewedAt: '2026-08-25T12:00:00.000Z',
        reviewedBy: 'test-reviewer',
        createdAt: '2026-08-25T11:00:00.000Z',
      },
    },
  }))
  ctx.provide('sessions', { open })
  ctx.provide('workspaces', { startSession })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const memoryCandidateReview = {
    list: async (request: unknown) => ({ ok: true as const, value: await list(request) }),
    markReviewed: async (request: Parameters<typeof markReviewed>[0]) => ({
      ok: true as const, value: await markReviewed(request),
    }),
  }
  ctx.provide('remote', { memoryCandidateReview } as never)
  ctx.provide('remote.memoryCandidateReview', memoryCandidateReview)
  slots.register({
    name: 'root',
    children: {
      conversation: { kind: 'single', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const declareHole = () => slots.register({
    name: 'conversation',
    children: { 'conversation.hero.dashboard': { kind: 'single', scope: 'root' } },
  } as never, () => null)
  const disposeHole = declare ? declareHole() : undefined
  return { ctx, slots, open, startSession, list, markReviewed, declareHole, disposeHole }
}

describe('ui-work-dashboard browser plugin', () => {
  it('declares only the services it binds', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.memoryCandidateReview',
    ])
  })

  it('fills declarations before or after apply and withdraws on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(1)
    expect(before.slots.entries('conversation.hero.dashboard')[0]?.component).toBe(WorkDashboard)
    expect(before.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(before.slots.entries('conversation.session.header.actions')[0]?.component).toBe(MemoryReviewButton)

    before.disposeHole?.()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(0)
    before.declareHole()
    await Promise.resolve()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(1)

    await fiber.dispose()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(0)
    expect(before.slots.entries('conversation.session.header.actions')).toHaveLength(0)

    const after = await bench(false)
    const afterFiber = after.ctx.plugin({ inject: [...inject], apply })
    await afterFiber.await()
    expect(after.slots.entries('conversation.hero.dashboard')).toHaveLength(0)
    after.declareHole()
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.dashboard')).toHaveLength(1)
  })

  it('unwraps review Remote results for the header control', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.session.header.actions')[0]!
    const actions = (entry.inject as unknown as () => MemoryReviewInjected)()
    const sessionId = 'session-one' as SessionId
    const candidateId = 'candidate-one' as MemoryCandidateId

    const page = await actions.list(sessionId)
    const reviewed = await actions.review(sessionId, candidateId, 'accept')

    expect(page.items).toEqual([])
    expect(b.list).toHaveBeenCalledWith({ sessionId, reviewed: false, limit: 50 })
    expect(b.markReviewed).toHaveBeenCalledWith({ sessionId, id: candidateId, decision: 'accept' })
    expect(reviewed.reviewDecision).toBe('accept')
  })

  it('delegates task start and recent-session navigation to their owners', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.hero.dashboard')[0]!
    const actions = (entry.inject as unknown as () => WorkDashboardInjected)()
    const workspaceId = 'workspace-one' as WorkspaceId
    const sessionId = 'session-one' as SessionId

    actions.startSession(workspaceId)
    actions.openSession(sessionId)

    expect(b.startSession).toHaveBeenCalledWith(workspaceId)
    expect(b.open).toHaveBeenCalledWith(sessionId)
  })
})
