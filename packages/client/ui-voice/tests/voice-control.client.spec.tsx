// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { VoiceCaptureView } from '../src/client/controller.ts'
import { pt } from '../src/client/locales.ts'
import {
  VoiceControl, type VoiceControlProps,
} from '../src/client/VoiceControl.tsx'

afterEach(cleanup)

const idle: VoiceCaptureView = {
  status: 'idle', level: 0, durationMs: 0, clip: null, transcript: null, error: null,
}

function props(view: VoiceCaptureView, overrides: Partial<VoiceControlProps> = {}): VoiceControlProps {
  return {
    input: {
      draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
    },
    inputActions: {
      setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn(),
    },
    useVoice: (selector: (state: VoiceCaptureView) => unknown) => selector(view),
    start: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    cancel: vi.fn(),
    acknowledgeTranscript: vi.fn(),
    t: makeTranslate(pt),
    ...overrides,
  } as unknown as VoiceControlProps
}

describe('VoiceControl', () => {
  it('starts from the microphone button and stops from the live meter', () => {
    const start = vi.fn(async () => undefined)
    const first = props(idle, { start })
    const view = render(<VoiceControl {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar voz' }))
    expect(start).toHaveBeenCalledOnce()

    const finish = vi.fn(async () => undefined)
    view.rerender(<VoiceControl {...props({ ...idle, status: 'listening', level: 0.5 }, { finish })} />)
    expect(screen.getByText('Leon está ouvindo…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Parar gravação' }))
    expect(finish).toHaveBeenCalledOnce()
  })

  it('shows a useful permission failure without browser exception text', () => {
    render(<VoiceControl {...props({
      ...idle, status: 'error', error: 'permission-denied',
    })} />)

    expect(screen.getByRole('status').textContent).toBe(
      'Permita o acesso ao microfone nas configurações do navegador.',
    )
  })

  it('routes a transcript through the ordinary draft and submit actions', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    const acknowledgeTranscript = vi.fn()
    render(<VoiceControl {...props({
      ...idle, status: 'transcribed', transcript: 'agende para amanhã',
    }, {
      input: { ...props(idle).input, draft: 'Leon,' },
      inputActions: { ...props(idle).inputActions, setDraft, submit },
      acknowledgeTranscript,
    })} />)

    expect(setDraft).toHaveBeenCalledWith('Leon, agende para amanhã')
    expect(submit).toHaveBeenCalledOnce()
    expect(acknowledgeTranscript).toHaveBeenCalledWith('agende para amanhã')
  })
})
