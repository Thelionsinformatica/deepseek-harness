import { describe, expect, it } from 'vitest'
import { checkArithmetic, isArithmeticTests } from '../src/arithmetic-validation.ts'

describe('bounded arithmetic validation', () => {
  const tests = [{ a: 2, b: 3, expected: 5 }, { a: -4, b: 7, expected: 3 }]
  it.each(['return a + b', 'return b+a'])('accepts equivalent expression %s', (answer) => {
    expect(checkArithmetic(answer, tests).passed).toBe(true)
  })
  it.each(['return a - b', 'return a * b', 'return a / b', 'return a + a'])('rejects wrong numeric results %s', (answer) => {
    expect(checkArithmetic(answer, tests).passed).toBe(false)
  })
  it.each(['return __import__("os")', 'return a.__class__', 'return a ** b', 'return a+b\n', 'return 5', 'return a+b;write()', '```return a+b```', 'return (a+b)', 'return ' + 'a'.repeat(100)])('refuses code outside its grammar %s', (answer) => {
    expect(checkArithmetic(answer, tests).evidence).toContain('Formato inválido')
  })
  it('reports non-finite division without accepting null or infinity', () => {
    expect(checkArithmetic('return a / b', [{ a: 2, b: 0, expected: 0 }])).toMatchObject({ passed: false })
    expect(checkArithmetic('return a / b', [{ a: 2, b: 0, expected: 0 }]).evidence).toContain('não finito')
  })
  it.each([undefined, null, [], [{ a: 1, b: 2 }], [{ a: 1, b: 2, expected: Infinity }], [{ a: 1, b: 2, expected: 3, command: 'shell' }], Array(9).fill(tests[0])])('rejects invalid test vectors', (value) => {
    expect(isArithmeticTests(value)).toBe(false)
  })
  it('bounds diagnostic size and accepts protocol limits', () => {
    const rows = Array.from({ length: 8 }, () => ({ a: 1_000_000, b: -1_000_000, expected: 0 }))
    expect(isArithmeticTests(rows)).toBe(true)
    expect(Buffer.byteLength(checkArithmetic('return a*b', rows).evidence)).toBeLessThan(2048)
  })
})
