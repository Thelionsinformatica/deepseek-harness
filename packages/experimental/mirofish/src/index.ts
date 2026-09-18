/**
 * Optional model-facing MiroFish simulation tool for the Leon Web composition.
 * It calls an already-running local MiroFish service and never installs or
 * starts that service itself.
 * @module @deepseek-ai/dsh-experimental-mirofish
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MiroFishClient } from './client.ts'
import type { MiroFishRunResult } from './client.ts'

export { MiroFishClient, MiroFishError, joinMiroFishUrl, readMiroFishEnvelope } from './client.ts'
export type {
  MiroFishClientConfig,
  MiroFishHttpRuntime,
  MiroFishRunRequest,
  MiroFishRunResult,
  MiroFishStage,
} from './client.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'experimental-mirofish'

/** Services used by the model-facing integration. */
export const inject = ['tools', 'systemPrompt', 'approval']

/** Runtime configuration for the optional local MiroFish bridge. */
export interface Config {
  /** Expose the tool. The generic bundle default is disabled. */
  enabled?: boolean
  /** MiroFish backend URL, normally http://127.0.0.1:5001. */
  baseUrl?: string
  /** Per-request HTTP timeout in milliseconds. */
  timeoutMs?: number
  /** Delay between asynchronous MiroFish status checks. */
  pollIntervalMs?: number
  /** Maximum total wait for each asynchronous stage. */
  maxWaitMs?: number
  /** Maximum seed text sent to MiroFish. */
  maxSeedChars?: number
  /** Maximum report characters returned to the model. */
  maxReportChars?: number
  /** Upper bound for user-requested simulation rounds. */
  maxRounds?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default('http://127.0.0.1:5001'),
  timeoutMs: z.number().default(300_000),
  pollIntervalMs: z.number().default(3_000),
  maxWaitMs: z.number().default(1_800_000),
  maxSeedChars: z.number().default(200_000),
  maxReportChars: z.number().default(120_000),
  maxRounds: z.number().default(40),
})

type ResolvedConfig = Required<Config>

interface MiroFishToolArgs {
  seed_text: string
  simulation_requirement: string
  project_name?: string
  max_rounds?: number
  platform?: 'parallel' | 'twitter' | 'reddit'
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`experimental-mirofish: ${name} must be a positive integer`)
}

function assertPositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`experimental-mirofish: ${name} must be positive`)
}

function validateArgs(args: MiroFishToolArgs, maxRounds: number): void {
  if (args.seed_text.trim().length === 0) throw new Error('seed_text must be a non-empty string')
  if (args.simulation_requirement.trim().length === 0) throw new Error('simulation_requirement must be a non-empty string')
  if (args.project_name !== undefined && args.project_name.trim().length === 0) throw new Error('project_name must be non-empty when provided')
  if (args.max_rounds !== undefined && (!Number.isInteger(args.max_rounds) || args.max_rounds < 1 || args.max_rounds > maxRounds)) {
    throw new Error(`max_rounds must be an integer between 1 and ${maxRounds}`)
  }
}

function presentCall(args: MiroFishToolArgs): GenericCallView {
  return {
    card: 'generic',
    title: args.project_name ?? 'Run MiroFish simulation',
    kind: 'execute',
    rawInput: args.simulation_requirement,
  }
}

function presentResult(_args: unknown, result: ToolResult): ToolResultView | undefined {
  if (result.isError) return { card: 'generic', content: result.content }
  return { card: 'generic', content: result.content }
}

function renderResult(value: MiroFishRunResult): string {
  const stages = value.stages.map(stage => `${stage.name}: ${stage.status}`).join(', ')
  const truncation = value.reportTruncated ? '\n\n[O relatório foi truncado pelo limite configurado.]' : ''
  return `Simulação MiroFish concluída.\n\nProjeto: ${value.projectId}\nSimulação: ${value.simulationId}\nRelatório: ${value.reportId}\nEtapas: ${stages}\n\n${value.reportMarkdown}${truncation}`
}

/** Register the optional MiroFish simulation tool when enabled by the composition. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  if (!resolved.enabled) return
  assertPositiveNumber('timeoutMs', resolved.timeoutMs)
  assertPositiveNumber('pollIntervalMs', resolved.pollIntervalMs)
  assertPositiveNumber('maxWaitMs', resolved.maxWaitMs)
  assertPositiveInteger('maxSeedChars', resolved.maxSeedChars)
  assertPositiveInteger('maxReportChars', resolved.maxReportChars)
  assertPositiveInteger('maxRounds', resolved.maxRounds)

  ctx.systemPrompt.section({
    name: 'tool:mirofish',
    order: 108,
    text: 'Use mirofish_simulate only when the user explicitly asks for a multi-agent scenario simulation or future rehearsal. Its result is a simulation report, not a guaranteed prediction. The tool sends the supplied seed text to the configured local MiroFish service and requires user approval before execution.',
  })

  const client = new MiroFishClient({
    baseUrl: resolved.baseUrl,
    timeoutMs: resolved.timeoutMs,
    pollIntervalMs: resolved.pollIntervalMs,
    maxWaitMs: resolved.maxWaitMs,
    maxSeedChars: resolved.maxSeedChars,
    maxReportChars: resolved.maxReportChars,
  })

  ctx.tools.register(defineTool({
    name: 'mirofish_simulate',
    description: 'Run a bounded MiroFish multi-agent simulation against the configured local MiroFish backend. Use only for explicit scenario rehearsal, behavior exploration, or future-scenario analysis. The seed is uploaded to MiroFish and the operation can take a long time; user approval is required.',
    parameters: {
      seed_text: { type: 'string', required: true, description: 'Source material for the simulation, such as a report, event description, policy draft, or fictional scenario.' },
      simulation_requirement: { type: 'string', required: true, description: 'The concrete question or scenario that MiroFish must simulate.' },
      project_name: { type: 'string', description: 'Optional human-readable project name.' },
      max_rounds: { type: 'integer', description: `Optional simulation-round cap from 1 to ${resolved.maxRounds}.` },
      platform: { type: 'string', enum: ['parallel', 'twitter', 'reddit'], description: 'Optional simulation platform mode; defaults to parallel.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, const: 'completed' },
          projectId: { type: 'string', required: true },
          graphId: { type: 'string' },
          simulationId: { type: 'string', required: true },
          reportId: { type: 'string', required: true },
          reportMarkdown: { type: 'string', required: true },
          reportTruncated: { type: 'boolean', required: true },
          stages: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                status: { type: 'string', required: true },
                progress: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    async execute(args: MiroFishToolArgs, exec) {
      validateArgs(args, resolved.maxRounds)
      if (exec.agent === undefined) throw new Error('mirofish_simulate requires a live agent session')
      const approval = await ctx.approval.request({
        agent: exec.agent,
        toolName: 'mirofish_simulate',
        callId: exec.callId,
        reason: 'Enviar o material fornecido ao MiroFish local e iniciar uma simulação multiagente potencialmente demorada.',
        signal: exec.signal,
      })
      if (approval !== 'allowed-once') throw new Error(`MiroFish simulation was not approved (${approval})`)
      return await client.run({
        seed: args.seed_text,
        requirement: args.simulation_requirement,
        ...args.project_name === undefined ? {} : { projectName: args.project_name },
        ...args.max_rounds === undefined ? {} : { maxRounds: args.max_rounds },
        ...args.platform === undefined ? {} : { platform: args.platform },
      }, exec.signal)
    },
    presentCall,
    presentResult,
  }))
}
