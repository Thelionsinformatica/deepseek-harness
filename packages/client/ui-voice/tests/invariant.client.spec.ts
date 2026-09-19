import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('ui-voice invariant companion', () => {
  it('reserves package ownership without adding a duplicate runtime rule', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const ctx = new Context()
    ctx.provide('invariants', { register })

    expect(name).toBe('client-ui-voice-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-voice', expect.any(Function))
  })
})
