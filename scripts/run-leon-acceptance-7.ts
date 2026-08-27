/** Run the seven Leon product acceptance criteria repeatedly without external API credentials. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { parseLeonEvalRawRun, type LeonEvalRawRun } from './leon-eval-ptbr-model.ts'
import {
  aggregateLeonAcceptance7,
  leonAcceptance7TestFiles,
  type LeonAcceptanceReport,
} from './leon-acceptance-7-model.ts'
import { parseLeonEvalRunnerArgs, resolveLeonReportPath, writeLeonReport } from './leon-eval-runner.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')
const REPORT_PATH_ENV = 'LEON_EVAL_REPORT_PATH'
const DEFAULT_OUTPUT = '.artifacts/leon-acceptance-7/latest.json'
const REQUIRED_RUNS = 3
const EXTERNAL_CREDENTIAL_KEYS = [
  'DEEPSEEK_API_KEY',
  'FREELLMAPI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'NVIDIA_API_KEY',
  'OMNIROUTE_API_KEY',
  'OPENAI_API_KEY',
] as const

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))

async function main(args: readonly string[]): Promise<number> {
  const options = parseLeonEvalRunnerArgs(args, {
    minimumRuns: REQUIRED_RUNS,
    defaultOutputPath: DEFAULT_OUTPUT,
    commandName: 'LEON-ACCEPTANCE-7',
  })
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leon-acceptance-7-'))
  const runs: LeonEvalRawRun[] = []
  let childFailed = false
  try {
    for (let index = 0; index < options.runs; index += 1) {
      const reportPath = join(temporaryRoot, `run-${index + 1}.json`)
      const result = await executeAcceptance(reportPath)
      childFailed ||= result.exitCode !== 0
      try {
        runs.push(parseLeonEvalRawRun(JSON.parse(await readFile(reportPath, 'utf8')) as unknown))
      } catch (error: unknown) {
        childFailed = true
        console.error(`LEON-ACCEPTANCE-7: execução ${index + 1} sem relatório válido.`)
        if (error instanceof Error) console.error(error.message)
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  const report = aggregateLeonAcceptance7(runs, undefined, REQUIRED_RUNS)
  const outputPath = resolveLeonReportPath(root, options.outputPath)
  await writeLeonReport(outputPath, report, { externalCredentialsRemoved: [...EXTERNAL_CREDENTIAL_KEYS] })
  printSummary(report, outputPath)
  return childFailed || report.status === 'failed' ? 1 : 0
}

async function executeAcceptance(reportPath: string): Promise<{ exitCode: number }> {
  const invocation = pnpmInvocation([
    'exec',
    'vitest',
    'run',
    ...leonAcceptance7TestFiles(),
    '--reporter=./scripts/leon-eval-ptbr-reporter.ts',
    '--maxWorkers=1',
    '--no-file-parallelism',
  ])
  const localOnlyEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !EXTERNAL_CREDENTIAL_KEYS.some(secret => secret === key)),
  )
  const env: NodeJS.ProcessEnv = {
    ...localOnlyEnvironment,
    [REPORT_PATH_ENV]: reportPath,
    LEON_ACC_006_REAL: '1',
    NO_COLOR: '1',
  }
  const result = await execa(invocation.command, invocation.args, {
    cwd: root,
    env,
    reject: false,
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return { exitCode: result.exitCode ?? 1 }
}

function printSummary(report: LeonAcceptanceReport, outputPath: string): void {
  console.log(`LEON-ACCEPTANCE-7: ${report.status === 'passed' ? 'APROVADO' : 'AINDA NÃO APROVADO'}`)
  console.log(`Comprovados: ${report.passedCriteria.length}/${report.criterionCount}`)
  console.log(`Parciais: ${report.partialCriteria.join(', ') || 'nenhum'}`)
  console.log(`Falhos: ${report.failedCriteria.join(', ') || 'nenhum'}`)
  console.log(`Execuções: ${report.runCount}; estável: ${report.stable ? 'sim' : 'não'}`)
  if (report.criticalFailures.length > 0) {
    console.error(`Pendências críticas: ${report.criticalFailures.join(', ')}`)
  }
  console.log(`Relatório: ${outputPath}`)
}
