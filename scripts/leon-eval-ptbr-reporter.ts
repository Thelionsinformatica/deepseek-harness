/** Content-free Vitest reporter used by the LEON-EVAL-PTBR coordinator. */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Reporter, TestCase, TestRunEndReason } from 'vitest/node'
import {
  LEON_EVAL_SCHEMA_VERSION,
  type LeonEvalRawRun,
  type LeonEvalTestResult,
} from './leon-eval-ptbr-model.ts'

const REPORT_PATH_ENV = 'LEON_EVAL_REPORT_PATH'

/** Reporter that records only test identity, status, duration, and memory use. */
export default class LeonEvalPtbrReporter implements Reporter {
  private readonly tests: LeonEvalTestResult[] = []

  /** Reset collected cases when Vitest starts a new run. */
  onTestRunStart(): void {
    this.tests.length = 0
  }

  /** Capture one completed evidence case without error or fixture content. */
  onTestCaseResult(testCase: TestCase): void {
    const diagnostic = testCase.diagnostic()
    const heapBytes = diagnostic?.heap
    this.tests.push({
      file: testCase.module.relativeModuleId.replaceAll('\\', '/'),
      testName: testCase.name,
      state: testCase.result().state,
      durationMs: diagnostic?.duration ?? 0,
      ...(heapBytes === undefined ? {} : { heapBytes }),
    })
  }

  /** Persist one sanitized run report for the coordinator. */
  async onTestRunEnd(
    _modules: ReadonlyArray<unknown>,
    _errors: ReadonlyArray<unknown>,
    reason: TestRunEndReason,
  ): Promise<void> {
    const outputPath = process.env[REPORT_PATH_ENV]
    if (outputPath === undefined || outputPath.trim() === '') {
      throw new Error(`${REPORT_PATH_ENV} must name the LEON-EVAL-PTBR run report`)
    }
    const report: LeonEvalRawRun = {
      schemaVersion: LEON_EVAL_SCHEMA_VERSION,
      reason,
      rssBytes: process.memoryUsage().rss,
      tests: [...this.tests].sort((left, right) => {
        const fileOrder = left.file.localeCompare(right.file, 'en')
        return fileOrder === 0 ? left.testName.localeCompare(right.testName, 'en') : fileOrder
      }),
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
}
