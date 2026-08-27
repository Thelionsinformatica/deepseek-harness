import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { VoiceControl } from '../src/client/VoiceControl.tsx'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  slots.register({
    name: 'root',
    children: { conversation: { kind: 'single', scope: 'root' } },
  } as never, () => null)
  const declareHole = () => slots.register({
    name: 'conversation',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const disposeHole = declare ? declareHole() : undefined
  return { ctx, slots, declareHole, disposeHole }
}

describe('ui-voice browser plugin', () => {
  it('declares only the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('follows the optional composer seat across declaration lifetimes', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(1)
    expect(b.slots.entries('conversation.input.right')[0]?.component).toBe(VoiceControl)

    b.disposeHole?.()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
    b.declareHole()
    await Promise.resolve()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(1)

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
  })

  it('exposes a cold resource-free controller before the first click', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.right')[0]!
    const face = (entry.inject as () => {
      hooks: { voice: { getSnapshot: () => { status: string } } }
    })()

    expect(face.hooks.voice.getSnapshot().status).toBe('idle')
    await fiber.dispose()
  })
})
