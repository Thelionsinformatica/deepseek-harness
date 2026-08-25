/** Execute repeated, keyless LEON-EVAL-PTBR baselines and write a sanitized report. */

import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execa } from 'execa'
import {
  aggregateLeonEvalRuns,
  leonEvalTestFiles,
  parseLeonEvalRawRun,
  type LeonEvalAggregateReport,
  type LeonEvalRawRun,
} from './leon-eval-ptbr-model.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')
const REPORT_PATH_ENV = 'LEON_EVAL_REPORT_PATH'
const DEFAULT_OUTPUT = '.artifacts/leon-eval-ptbr/latest.json'
const REQUIRED_BASELINE_RUNS = 3

interface Options {
  readonly runs: number
  readonly outputPath: string
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))

async function main(args: readonly string[]): Promise<number> {
  const options = parseArgs(args)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leon-eval-ptbr-'))
  const runs: LeonEvalRawRun[] = []
  let childFailed = false
  try {
    for (let index = 0; index < options.runs; index += 1) {
      const reportPath = join(temporaryRoot, `run-${index + 1}.json`)
      const result = await executeBaseline(reportPath)
      childFailed ||= result.exitCode !== 0
      try {
        const raw = JSON.parse(await readFile(reportPath, 'utf8')) as unknown
        runs.push(parseLeonEvalRawRun(raw))
      } catch (error: unknown) {
        console.error(`LEON-EVAL-PTBR: a execução ${index + 1} não produziu um relatório válido.`)
        if (error instanceof Error) console.error(error.message)
        childFailed = true
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  const report = aggregateLeonEvalRuns(runs, undefined, { minimumRuns: REQUIRED_BASELINE_RUNS })
  const outputPath = isAbsolute(options.outputPath) ? options.outputPath : resolve(root, options.outputPath)
  await writeReport(outputPath, report)
  printSummary(report, outputPath)
  return childFailed || report.status === 'failed' ? 1 : 0
}

async function executeBaseline(reportPath: string): Promise<{ exitCode: number }> {
  const invocation = pnpmInvocation([
    'exec',
    'vitest',
    'run',
    ...leonEvalTestFiles(),
    '--reporter=./scripts/leon-eval-ptbr-reporter.ts',
    '--logHeapUsage',
    '--maxWorkers=1',
    '--no-file-parallelism',
  ])
  const result = await execa(invocation.command, invocation.args, {
    cwd: root,
    env: { ...process.env, [REPORT_PATH_ENV]: reportPath, NO_COLOR: '1' },
    reject: false,
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return { exitCode: result.exitCode ?? 1 }
}

function parseArgs(args: readonly string[]): Options {
  let runs = REQUIRED_BASELINE_RUNS
  let outputPath = DEFAULT_OUTPUT
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--runs') {
      const raw = args[index + 1]
      const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
      if (!Number.isSafeInteger(parsed) || parsed < REQUIRED_BASELINE_RUNS || raw !== String(parsed)) {
        throw new Error(`--runs must be an integer >= ${REQUIRED_BASELINE_RUNS}`)
      }
      runs = parsed
      index += 1
      continue
    }
    if (argument === '--output') {
      const raw = args[index + 1]
      if (raw === undefined || raw.trim() === '') throw new Error('--output requires a file path')
      outputPath = raw
      index += 1
      continue
    }
    throw new Error(`unknown LEON-EVAL-PTBR argument: ${JSON.stringify(argument)}`)
  }
  return { runs, outputPath }
}

async function writeReport(path: string, report: LeonEvalAggregateReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  const artifact = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    ...report,
  }
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await rm(path, { force: true })
  await rename(temporaryPath, path)
}

function printSummary(report: LeonEvalAggregateReport, outputPath: string): void {
  const passed = report.scenarioCount - report.failedScenarios.length
  console.log(`LEON-EVAL-PTBR: ${report.status === 'passed' ? 'APROVADO' : 'REPROVADO'}`)
  console.log(`Cenários: ${passed}/${report.scenarioCount} em ${report.runCount} execuções`)
  console.log(`Precisão do oracle: ${percent(report.metrics.oraclePrecision)}`)
  console.log(`Recall@k: ${percent(report.metrics.recallAtK)}`)
  console.log(`Falsos positivos de recall: ${percent(report.metrics.recallFalsePositiveRate)}`)
  console.log(`Vazamento entre projetos/usuários: ${percent(report.metrics.crossWorkspaceLeakageRate)} / ${percent(report.metrics.crossUserLeakageRate)}`)
  console.log(`Vazamento sensível/nuvem: ${percent(report.metrics.sensitiveDataLeakageRate)} / ${percent(1 - report.metrics.cloudConsentComplianceRate)}`)
  console.log(`Latência p50/p95: ${report.latencyMs.p50.toFixed(1)} ms / ${report.latencyMs.p95.toFixed(1)} ms`)
  console.log(`Heap p50/p95: ${formatBytes(report.heapBytes.p50)} / ${formatBytes(report.heapBytes.p95)}`)
  if (report.criticalFailures.length > 0) {
    console.error(`Falhas críticas: ${report.criticalFailures.join(', ')}`)
  }
  if (report.missingEvidence.length > 0) {
    console.error(`Evidências ausentes: ${report.missingEvidence.length}`)
  }
  console.log(`Relatório: ${outputPath}`)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
