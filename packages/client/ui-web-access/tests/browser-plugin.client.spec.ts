/** Browser registration and command bridge for the explicit Web-access control. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { WebAccessControl } from '../src/client/WebAccessControl.tsx'
import type { WebAccessControlInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 'web-access-test' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { conversation: { kind: 'single', scope: 'root' } },
  } as never, () => null)
  slots.register({
    name: 'conversation',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'web-1', result: { kind: 'success' as const } } }))
  const commands = { execute }
  ctx.provide('remote', { commands })
  ctx.provide('remote.commands', commands)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute }
}

describe('ui-web-access browser plugin', () => {
  it('declares every service it binds and keeps its node half inert', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers on the existing right-side composer list and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.right')[0]!
    expect(entry.component).toBe(WebAccessControl)

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
  })

  it('bridges both deliberate button decisions to the exact /web command', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.right')[0]!
    const face = (entry.inject as unknown as (id: SessionId) => WebAccessControlInjected)(SID)

    await expect(face.toggleWebAccess(true)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web on', [])
    await expect(face.toggleWebAccess(false)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web off', [])

    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(face.toggleWebAccess(true)).resolves.toBe('unknown command: /web on')
  })
})
