/** Bounded binary arithmetic checks; no eval, parser runtime, subprocess or filesystem access. */
export interface ArithmeticTest {
  a: number
  b: number
  expected: number
}

/**
 * Validate durable or wire-supplied test vectors, bounded to eight finite numeric examples.
 * @param value Untrusted numeric examples, never executable validation commands.
 * @returns Whether every entry belongs to the restricted test protocol.
 */
export function isArithmeticTests(value: unknown): value is ArithmeticTest[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every((row: unknown) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 3) return false
    const record = row as Record<string, unknown>
    return ['a', 'b', 'expected'].every((key) => {
      const number = record[key]
      return typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1_000_000
    })
  })
}

/**
 * Interpret only `return a <operator> b` and operand permutations; compare numeric examples exactly.
 * @param answer Model output, limited to 80 characters and one line.
 * @param tests Validated finite examples from the trusted task producer.
 * @returns Pass status and bounded diagnostic suitable for a logged recovery message.
 */
export function checkArithmetic(answer: string, tests: readonly ArithmeticTest[]): { passed: boolean; evidence: string } {
  const match = answer.length <= 80 && !/[\r\n]/.test(answer)
    ? /^return[ \t]+([ab])[ \t]*([+*/-])[ \t]*([ab])$/.exec(answer) : null
  if (match === null) return { passed: false, evidence: 'Formato inválido. Use uma única linha return com dois operandos a ou b e uma operação +, -, * ou /. Sem explicação, cercas, chamadas ou comandos.' }
  const rows = tests.map(({ a, b, expected }) => {
    const left = match[1] === 'a' ? a : b
    const right = match[3] === 'a' ? a : b
    const actual = match[2] === '+' ? left + right : match[2] === '-' ? left - right
      : match[2] === '*' ? left * right : left / right
    return { a, b, expected, actual: Number.isFinite(actual) ? actual : 'não finito', passed: Number.isFinite(actual) && actual === expected }
  })
  return { passed: rows.every(row => row.passed), evidence: JSON.stringify(rows) }
}
