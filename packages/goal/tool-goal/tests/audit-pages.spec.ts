import { describe, expect, it } from 'vitest'
import { AuditPages } from '../src/audit-pages.ts'

describe('audit evidence pages', () => {
  it('delivers every character within the complete page budget and detects unread pages', () => {
    const original = JSON.stringify({ text: 'ação "\\\n🦁'.repeat(400) })
    const pages = new AuditPages(original, 256)
    expect(pages.pages.length).toBeGreaterThan(1)
    expect(pages.complete).toBe(false)
    expect(pages.pages.every(page => page.length <= 256)).toBe(true)
    pages.read(1)
    pages.read(1)
    expect(pages.complete).toBe(false)
    const rebuilt = pages.pages.map((_page, index) => (JSON.parse(pages.read(index + 1)) as { fragment: string }).fragment).join('')
    expect(rebuilt).toBe(original)
    expect(pages.complete).toBe(true)
  })
  it('rejects unusable budgets and invalid page indices', () => {
    expect(() => new AuditPages('evidence', 1)).toThrow('page limit')
    const pages = new AuditPages('evidence', 256)
    for (const page of [0, -1, 2, 1.5, NaN]) expect(() => pages.read(page)).toThrow('page number')
    expect(pages.complete).toBe(false)
  })
})
