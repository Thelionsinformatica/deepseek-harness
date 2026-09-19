/** Shared command-line and artifact helpers for Leon evaluation runners. */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

/** Parsed options shared by repeated Leon evaluation runners. */
export interface LeonEvalRunnerOptions {
  readonly runs: number
  readonly outputPath: string
}

/** Fixed defaults and diagnostics for one Leon evaluation command. */
export interface LeonEvalRunnerDefaults {
  readonly minimumRuns: number
  readonly defaultOutputPath: string
  readonly commandName: string
}

/**
 * Parse the common run count and output path accepted by Leon evaluation commands.
 * @param args - Command-line arguments after the executable and script path.
 * @param defaults - Per-command minimum, output path, and diagnostic label.
 * @returns Validated evaluation options.
 */
export function parseLeonEvalRunnerArgs(
  args: readonly string[],
  defaults: LeonEvalRunnerDefaults,
): LeonEvalRunnerOptions {
  let runs = defaults.minimumRuns
  let outputPath = defaults.defaultOutputPath
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--runs') {
      const raw = args[index + 1]
      const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
      if (!Number.isSafeInteger(parsed) || parsed < defaults.minimumRuns || raw !== String(parsed)) {
        throw new Error(`--runs must be an integer >= ${defaults.minimumRuns}`)
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
    throw new Error(`unknown ${defaults.commandName} argument: ${JSON.stringify(argument)}`)
  }
  return { runs, outputPath }
}

/**
 * Resolve one requested report path against the repository root.
 * @param root - Absolute repository root.
 * @param requestedPath - Absolute path or repository-relative path.
 * @returns Absolute report path.
 */
export function resolveLeonReportPath(root: string, requestedPath: string): string {
  return isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath)
}

/**
 * Write a Leon report with common runtime metadata through a same-directory temporary file.
 * @param path - Absolute destination path.
 * @param report - Evaluation-specific report fields.
 * @param metadata - Optional runner-specific metadata inserted before the report.
 * @returns A promise settled after the destination has been replaced.
 */
export async function writeLeonReport(
  path: string,
  report: object,
  metadata: object = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  const artifact = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    ...metadata,
    ...report,
  }
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await rm(path, { force: true })
  await rename(temporaryPath, path)
}
