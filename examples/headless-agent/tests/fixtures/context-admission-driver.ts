#!/usr/bin/env node
/** Test-only process entry: boot the real config, emit outcome facts, dispose every service. */
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { runContextAdmissionScenario } from './context-admission-scenario.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('context-admission-driver: expected <config-path>')
const uninstallFailLoud = installFailLoud('context-admission-driver')
let ctx: Context | undefined
try {
  ctx = await boot('context-admission-driver', configPath)
  process.stdout.write(`${JSON.stringify(await runContextAdmissionScenario(ctx))}\n`)
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
