import { describe, expect, it } from 'vitest'
import type { LeonEvalRawRun } from './leon-eval-ptbr-model.ts'
import {
  aggregateLeonAcceptance7,
  LEON_ACCEPTANCE_7_CRITERIA,
} from './leon-acceptance-7-model.ts'

function completeRun(state: 'passed' | 'failed' = 'passed'): LeonEvalRawRun {
  return {
    schemaVersion: 1,
    reason: state,
    rssBytes: 1,
    tests: LEON_ACCEPTANCE_7_CRITERIA.flatMap(criterion => criterion.evidence.map(evidence => ({
      file: evidence.file,
      testName: evidence.testName,
      state,
      durationMs: 1,
    }))),
  }
}

describe('LEON-ACCEPTANCE-7 aggregation', () => {
  it('approves only after every one of the seven requirements has decisive repeated evidence', () => {
    const report = aggregateLeonAcceptance7([completeRun(), completeRun(), completeRun()])

    expect(report).toMatchObject({
      status: 'passed',
      minimumRunsMet: true,
      stable: true,
      criterionCount: 7,
      passedCriteria: [
        'LEON-ACC-001',
        'LEON-ACC-002',
        'LEON-ACC-003',
        'LEON-ACC-004',
        'LEON-ACC-005',
        'LEON-ACC-006',
        'LEON-ACC-007',
      ],
      partialCriteria: [],
      failedCriteria: [],
      criticalFailures: [],
    })
  })

  it('fails closed when one exact test is absent from any repetition', () => {
    const incomplete = completeRun()
    const missing = {
      ...incomplete,
      tests: incomplete.tests.filter(test => test.testName !== LEON_ACCEPTANCE_7_CRITERIA[0]?.evidence[0]?.testName),
    }
    const report = aggregateLeonAcceptance7([completeRun(), completeRun(), missing])

    expect(report.failedCriteria).toContain('LEON-ACC-001')
    expect(report.missingEvidence).toContain(
      'packages/core/agent-loop/tests/resume.spec.ts::resumes one pending task after a runtime restart while switching the selected model',
    )
    expect(report.status).toBe('failed')
  })
})
