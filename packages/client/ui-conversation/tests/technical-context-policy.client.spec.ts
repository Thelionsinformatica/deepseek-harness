// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSettings } from '../src/submission-settings.ts'
import { DEFAULT_SHOW_TECHNICAL_CONTEXT } from '../src/submission-settings.ts'
import { TechnicalContextPolicy } from '../src/client/settings/technical-context-policy.ts'

describe('TechnicalContextPolicy', () => {
  it('hides technical context by default and publishes changes before persistence', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const observed: string[] = []
    let live = (): boolean => true
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${String(live())}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new TechnicalContextPolicy(scope)
    live = () => policy.visible.getSnapshot()

    expect(policy.visible.getSnapshot()).toBe(DEFAULT_SHOW_TECHNICAL_CONTEXT)
    policy.setVisible(true)
    expect(observed).toEqual(['showTechnicalContext=true:true'])
    expect(host.set).toHaveBeenCalledWith('showTechnicalContext', true)
  })

  it('adopts Host changes without a duplicate write', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new TechnicalContextPolicy(host.scope)
    host.publish({
      status: 'ready', value: { busyEnter: 'queue', showTechnicalContext: true }, revision: 1, writable: true,
    })
    expect(policy.visible.getSnapshot()).toBe(true)
    policy.setVisible(true)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('stays process-local when no Host settings scope is composed', () => {
    const policy = new TechnicalContextPolicy()
    const changed = vi.fn()
    policy.visible.subscribe(changed)
    policy.setVisible(true)
    expect(changed).toHaveBeenCalledOnce()
  })
})
