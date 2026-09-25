// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { GettingToKnowYou } from '../src/client/GettingToKnowYou.tsx'
import { pt } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(pt)
function reviewFirst(): void {
  fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.start'] }))
  fireEvent.change(screen.getByLabelText(pt['memory.intro.question.name']), { target: { value: 'Aleus' } })
  fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.next'] }))
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.skip'] }))
}

describe('optional personal interview', () => {
  it('keeps answers local, allows editing and saves only a specifically confirmed answer once', async () => {
    const save = vi.fn(() => Promise.resolve())
    render(<GettingToKnowYou t={t} disabled={false} save={save} />)
    reviewFirst()
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(pt['memory.intro.question.name']), { target: { value: 'Pode me chamar de Aleus.' } })
    const confirm = screen.getByRole('button', { name: pt['memory.intro.save'] })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await screen.findByText(pt['memory.intro.saved'])
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(`${pt['memory.intro.question.name']}\nPode me chamar de Aleus.`)
    expect(screen.queryByRole('button', { name: pt['memory.intro.save'] })).toBeNull()
  })
  it('discards without saving or granting permissions', () => {
    const save = vi.fn()
    render(<GettingToKnowYou t={t} disabled={false} save={save} />)
    reviewFirst()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.discard'] }))
    expect(screen.getByText(pt['memory.intro.empty'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.close'] }))
    expect(save).not.toHaveBeenCalled()
  })
  it('preserves the editable draft after host refusal', async () => {
    const save = vi.fn(() => Promise.reject(new Error('sensitive-content')))
    render(<GettingToKnowYou t={t} disabled={false} save={save} />)
    reviewFirst()
    fireEvent.click(screen.getByRole('button', { name: pt['memory.intro.save'] }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText<HTMLTextAreaElement>(pt['memory.intro.question.name']).value).toBe('Aleus')
    expect(screen.queryByText(pt['memory.intro.saved'])).toBeNull()
    await waitFor(() => { expect(screen.getByRole('button', { name: pt['memory.intro.save'] }).hasAttribute('disabled')).toBe(false) })
  })
  it('honors disabled memory and read-only availability', () => {
    render(<GettingToKnowYou t={t} disabled save={vi.fn()} />)
    expect(screen.getByRole('button', { name: pt['memory.intro.start'] }).hasAttribute('disabled')).toBe(true)
  })
})
