import { describe, expect, it } from 'vitest'
import {
  aggregateLeonEvalRuns,
  LEON_EVAL_SCENARIOS,
  LEON_EVAL_SCHEMA_VERSION,
  leonEvalTestFiles,
  parseLeonEvalRawRun,
  type LeonEvalRawRun,
  type LeonEvalTestResult,
} from './leon-eval-ptbr-model.ts'

function baseline(
  states: ReadonlyMap<string, LeonEvalTestResult['state']> = new Map(),
  reason: LeonEvalRawRun['reason'] = 'passed',
): LeonEvalRawRun {
  const tests = new Map<string, LeonEvalTestResult>()
  for (const scenario of LEON_EVAL_SCENARIOS) {
    for (const item of scenario.evidence) {
      const key = `${item.file} :: ${item.testName}`
      tests.set(key, {
        file: item.file,
        testName: item.testName,
        state: states.get(key) ?? 'passed',
        durationMs: 25,
        heapBytes: 32 * 1024 * 1024,
      })
    }
  }
  return {
    schemaVersion: LEON_EVAL_SCHEMA_VERSION,
    reason,
    rssBytes: 128 * 1024 * 1024,
    tests: [...tests.values()],
  }
}

describe('LEON-EVAL-PTBR runner model', () => {
  it('registers 20+ unique scenarios and only the required test files', () => {
    expect(LEON_EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(LEON_EVAL_SCENARIOS.map(item => item.id)).size).toBe(LEON_EVAL_SCENARIOS.length)
    expect(LEON_EVAL_SCENARIOS.every(item => item.evidence.length > 0)).toBe(true)
    expect(leonEvalTestFiles()).toEqual([...leonEvalTestFiles()].sort())
    expect(leonEvalTestFiles()).toContain('packages/memory/tool-memory/tests/integration.spec.ts')
  })

  it('accepts three stable complete baselines and calculates bounded metrics', () => {
    const report = aggregateLeonEvalRuns([baseline(), baseline(), baseline()])

    expect(report).toMatchObject({
      status: 'passed',
      runCount: 3,
      scenarioCount: LEON_EVAL_SCENARIOS.length,
      minimumRunsMet: true,
      stable: true,
      failedScenarios: [],
      criticalFailures: [],
      missingEvidence: [],
      metrics: {
        oraclePrecision: 1,
        recallAtK: 1,
        falseDiscoveryRate: 0,
        recallFalsePositiveRate: 0,
        crossWorkspaceLeakageRate: 0,
        crossUserLeakageRate: 0,
        sensitiveDataLeakageRate: 0,
        confirmationRate: 1,
        rejectionRate: 1,
        cloudConsentComplianceRate: 1,
        promptInjectionRejectionRate: 1,
      },
      latencyMs: { p50: 25, p95: 50, withinTarget: true },
      heapBytes: { samples: LEON_EVAL_SCENARIOS.length * 3, withinTarget: true },
    })
  })

  it('hard-fails a critical scenario and reports the exact id', () => {
    const critical = LEON_EVAL_SCENARIOS.find(item => item.id === 'LEON-MEM-004')
    const firstEvidence = critical?.evidence[0]
    if (firstEvidence === undefined) throw new Error('critical fixture missing')
    const key = `${firstEvidence.file} :: ${firstEvidence.testName}`
    const failed = baseline(new Map([[key, 'failed']]), 'failed')
    const report = aggregateLeonEvalRuns([baseline(), failed, baseline()])

    expect(report.status).toBe('failed')
    expect(report.criticalFailures).toContain('LEON-MEM-004')
    expect(report.metrics.crossWorkspaceLeakageRate).toBeGreaterThan(0)
    expect(report.stable).toBe(false)
  })

  it('fails closed when executable evidence is missing', () => {
    const [first, ...rest] = baseline().tests
    if (first === undefined) throw new Error('baseline fixture missing')
    const missing: LeonEvalRawRun = { ...baseline(), tests: rest }
    const report = aggregateLeonEvalRuns([missing, missing, missing])

    expect(report.status).toBe('failed')
    expect(report.missingEvidence).toContain(`${first.file} :: ${first.testName}`)
  })

  it('requires three runs and validates the reporter file before aggregation', () => {
    expect(aggregateLeonEvalRuns([baseline(), baseline()])).toMatchObject({
      status: 'failed',
      minimumRunsMet: false,
    })
    expect(parseLeonEvalRawRun(baseline())).toEqual(baseline())
    expect(() => parseLeonEvalRawRun({ schemaVersion: 99, tests: [] })).toThrow(/schema version/)
    expect(() => parseLeonEvalRawRun({
      schemaVersion: LEON_EVAL_SCHEMA_VERSION,
      reason: 'passed',
      rssBytes: 1,
      tests: [{ file: 'x', testName: 'y', state: 'unknown', durationMs: 1 }],
    })).toThrow(/invalid test result/)
  })
})
