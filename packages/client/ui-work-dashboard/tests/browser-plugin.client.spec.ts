import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type SessionId, type WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { WorkDashboard } from '../src/client/WorkDashboard.tsx'
import type { WorkDashboardInjected } from '../src/client/WorkDashboard.tsx'
import { apply, inject } from '../src/client/index.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const open = vi.fn()
  const startSession = vi.fn()
  ctx.provide('sessions', { open })
  ctx.provide('workspaces', { startSession })
  ctx.provide('locale', new LocaleRuntime(ctx))
  slots.register({
    name: 'root',
    children: { conversation: { kind: 'single', scope: 'root' } },
  } as never, () => null)
  const declareHole = () => slots.register({
    name: 'conversation',
    children: { 'conversation.hero.dashboard': { kind: 'single', scope: 'root' } },
  } as never, () => null)
  const disposeHole = declare ? declareHole() : undefined
  return { ctx, slots, open, startSession, declareHole, disposeHole }
}

describe('ui-work-dashboard browser plugin', () => {
  it('declares only the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale'])
  })

  it('fills declarations before or after apply and withdraws on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(1)
    expect(before.slots.entries('conversation.hero.dashboard')[0]?.component).toBe(WorkDashboard)

    before.disposeHole?.()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(0)
    before.declareHole()
    await Promise.resolve()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(1)

    await fiber.dispose()
    expect(before.slots.entries('conversation.hero.dashboard')).toHaveLength(0)

    const after = await bench(false)
    const afterFiber = after.ctx.plugin({ inject: [...inject], apply })
    await afterFiber.await()
    expect(after.slots.entries('conversation.hero.dashboard')).toHaveLength(0)
    after.declareHole()
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.dashboard')).toHaveLength(1)
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
