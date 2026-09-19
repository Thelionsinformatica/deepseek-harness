import { describe, expect, it } from 'vitest'
import { isLocalNavigation, shouldRegisterWindowsAutoStart } from '../src/config.ts'

describe('desktop navigation policy', () => {
  it('keeps same-origin navigation in the native window', () => {
    expect(isLocalNavigation('http://127.0.0.1:43125/settings', 'http://127.0.0.1:43125')).toBe(true)
  })

  it('rejects external navigation and malformed URLs', () => {
    expect(isLocalNavigation('https://example.com', 'http://127.0.0.1:43125')).toBe(false)
    expect(isLocalNavigation('not a URL', 'http://127.0.0.1:43125')).toBe(false)
  })

  it('registers auto-start only for packaged Windows builds', () => {
    expect(shouldRegisterWindowsAutoStart('win32', true)).toBe(true)
    expect(shouldRegisterWindowsAutoStart('win32', false)).toBe(false)
    expect(shouldRegisterWindowsAutoStart('linux', true)).toBe(false)
  })
})
