import { describe, expect, it } from 'vitest'
import {
  auditDomainViolations,
  resolveClientImport,
  type Violation,
} from './verify-client-domain-graph.ts'

const legacyViolation: Violation = {
  file: 'example/src/client/chat/view.ts',
  imported: '../input/contract.ts',
  reason: 'test fixture',
}

const legacyKey = 'example/src/client/chat/view.ts -> ../input/contract.ts'

describe('client domain import resolution', () => {
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })

  it('accepts only the exact locked legacy occurrence budget', () => {
    expect(auditDomainViolations([legacyViolation], { [legacyKey]: 1 })).toEqual({
      acceptedLegacyOccurrences: 1,
      regressions: [],
      staleBudgets: [],
    })
  })

  it('rejects both new occurrences and stale budgets', () => {
    const regression = auditDomainViolations(
      [legacyViolation, legacyViolation],
      { [legacyKey]: 1 },
    )
    expect(regression.regressions).toEqual([
      { actual: 2, allowed: 1, key: legacyKey },
    ])

    const cleanup = auditDomainViolations([], { [legacyKey]: 1 })
    expect(cleanup.staleBudgets).toEqual([
      { actual: 0, allowed: 1, key: legacyKey },
    ])
  })
})
