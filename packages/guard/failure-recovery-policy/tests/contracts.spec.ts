import { describe, expect, it } from 'vitest'
import {
  defineToolPolicy,
  resolveToolPolicy,
} from '@deepseek-ai/dsh-failure-recovery-policy'

describe('tool recovery adapter contract', () => {
  it('pins code-owned canonicalization and invocation risk outside the model', () => {
    const policy = defineToolPolicy({
      toolName: 'send_message',
      canonicalizerVersion: 1,
      resolve(args) {
        const target = (args as { target: string }).target.trim().toLowerCase()
        return {
          signature: `send_message:${target}:hello`,
          equivalenceFamily: `send_message:${target}`,
          normalizedTarget: target,
          effect: 'external',
          retrySafe: false,
        }
      },
    })

    expect(resolveToolPolicy(policy, { target: ' USER@example.com ' })).toEqual({
      signature: 'send_message:user@example.com:hello',
      equivalenceFamily: 'send_message:user@example.com',
      normalizedTarget: 'user@example.com',
      effect: 'external',
      retrySafe: false,
    })
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('rejects ambiguous policy registrations and incomplete resolved identities', () => {
    expect(() => defineToolPolicy({
      toolName: ' ', canonicalizerVersion: 1, resolve: () => {
        throw new Error('unreachable')
      },
    })).toThrow(/name must be non-blank/)
    expect(() => defineToolPolicy({
      toolName: 'probe', canonicalizerVersion: 0, resolve: () => {
        throw new Error('unreachable')
      },
    })).toThrow(/integer >= 1/)
    const incomplete = defineToolPolicy({
      toolName: 'probe', canonicalizerVersion: 1, resolve: () => ({
        signature: '', equivalenceFamily: 'probe', normalizedTarget: 'target', effect: 'none', retrySafe: true,
      }),
    })
    expect(() => resolveToolPolicy(incomplete, {})).toThrow(/blank signature/)
  })
})
