// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_PERSONALIZATION,
  type PersonalMemorySettings,
  type PersonalizationSettings,
} from '@deepseek-ai/dsh-client-ui-settings-personalization'
import {
  PersonalizationSection,
  type PersonalizationSectionProps,
} from '@deepseek-ai/dsh-client-ui-settings-personalization/client'
import { pt, type PersonalizationKey } from '../src/client/locales.ts'

const sessionId = 'session-personalization' as SessionId

afterEach(() => { cleanup() })

function translate(key: PersonalizationKey, params?: Record<string, string>): string {
  let value = pt[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, replacement)
  }
  return value
}

function ready<T>(value: T): SettingsScopeSnapshot<T> {
  return {
    status: 'ready', value, base: value, user: {}, revision: 1,
    writable: true, mode: 'host',
  }
}

function props(overrides: Partial<PersonalizationSectionProps> = {}): PersonalizationSectionProps {
  const personalization = ready<PersonalizationSettings>(DEFAULT_PERSONALIZATION)
  const memory = ready<PersonalMemorySettings>({ enabled: true })
  return {
    usePersonalization: selector => selector(personalization),
    usePersonalMemory: selector => selector(memory),
    useSessions: selector => selector({ current: sessionId }),
    saveInstructions: vi.fn(() => Promise.resolve()),
    setPersonality: vi.fn(() => Promise.resolve()),
    setToolAssistedMemory: vi.fn(() => Promise.resolve()),
    setPersonalMemoryEnabled: vi.fn(() => Promise.resolve()),
    clearPersonalMemories: vi.fn(() => Promise.resolve(2)),
    t: translate,
    ...overrides,
  }
}

describe('PersonalizationSection', () => {
  it('saves instructions, changes style, and toggles real memory preferences', async () => {
    const input = props()
    render(<PersonalizationSection {...input} />)

    fireEvent.change(screen.getByLabelText(pt.instructionsLabel), {
      target: { value: 'Valide cada entrega com evidências.' },
    })
    fireEvent.click(screen.getByRole('button', { name: pt.save }))
    await screen.findByText(pt.saved)
    expect(input.saveInstructions).toHaveBeenCalledWith('Valide cada entrega com evidências.')

    fireEvent.change(screen.getByLabelText(pt.personalityLabel), { target: { value: 'professional' } })
    await waitFor(() => { expect(input.setPersonality).toHaveBeenCalledWith('professional') })
    await waitFor(() => { expect(screen.getByRole('switch', { name: pt.memoryEnabledTitle }).hasAttribute('disabled')).toBe(false) })

    fireEvent.click(screen.getByRole('switch', { name: pt.memoryEnabledTitle }))
    await waitFor(() => { expect(input.setPersonalMemoryEnabled).toHaveBeenCalledWith(false) })
    await waitFor(() => { expect(screen.getByRole('switch', { name: pt.toolMemoryTitle }).hasAttribute('disabled')).toBe(false) })

    fireEvent.click(screen.getByRole('switch', { name: pt.toolMemoryTitle }))
    await waitFor(() => { expect(input.setToolAssistedMemory).toHaveBeenCalledWith(false) })
  })

  it('requires a visible confirmation before deleting personal memories', async () => {
    const input = props()
    render(<PersonalizationSection {...input} />)

    fireEvent.click(screen.getByRole('button', { name: pt.delete }))
    expect(screen.getByRole('dialog', { name: pt.deleteDialogTitle })).toBeTruthy()
    expect(input.clearPersonalMemories).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: pt.deleteConfirm }))
    expect(input.clearPersonalMemories).toHaveBeenCalledWith(sessionId)
    expect(await screen.findByText('2 memórias pessoais foram excluídas.')).toBeTruthy()
  })

  it('disables destructive memory deletion when no auditable session is open', () => {
    const input = props({ useSessions: selector => selector({ current: undefined }) })
    render(<PersonalizationSection {...input} />)
    expect(screen.getByRole('button', { name: pt.delete }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(pt.deleteNeedsSession)).toBeTruthy()
  })
})
