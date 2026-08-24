/**
 * Model-facing `get_goal`, `create_goal`, and `update_goal` tools over the
 * persisted same-session goal domain.
 * @module @deepseek-ai/dsh-tool-goal
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import { boundContextSummary, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { TodoItem } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  completionAuthority,
  goalToolExecution,
  requireDirectHuman,
  type GoalToolExecution,
} from './authority.ts'
import {
  CompletionAuditAttempts,
  requireCompletionAudit,
  type CompletionAuditorConfig,
} from './quality-audit.ts'
import { renderWrapupContext } from './wrapup.ts'

export const name = 'tool-goal'
export const inject = ['agents', 'goals', 'tools', 'systemPrompt']

/** Model policy and hard lower bounds for goal-state updates. */
export interface Config {
  /** Minimum admitted goal rounds before the model may self-report `blocked`. */
  blockedAfterConsecutiveRounds?: number
  /** Refuse completion until this goal has a non-empty todo list whose items are all completed. */
  completionRequiresCompletedTodos?: boolean
  /** Named one-shot subagent provider for independent completion review; empty disables review. */
  completionAuditorProvider?: string
  /** LLM provider used only by the independent completion auditor. */
  completionAuditorModelProvider?: string
  /** Model used only by the independent completion auditor. */
  completionAuditorModel?: string
  /** Maximum output tokens for each auditor request. */
  completionAuditorMaxTokens?: number
  /** Maximum auditor starts accepted in one executor turn. */
  completionAuditorMaxAttemptsPerTurn?: number
  /** Maximum correction-report characters returned to the executor. */
  completionAuditorReportMaxCharacters?: number
}

/** Schemastery config for the goal-tool policy. */
export const Config: z<Config> = z.object({
  blockedAfterConsecutiveRounds: z.number().step(1).min(1).default(3),
  completionRequiresCompletedTodos: z.boolean().default(false),
  completionAuditorProvider: z.string().default(''),
  completionAuditorModelProvider: z.string().default(''),
  completionAuditorModel: z.string().default(''),
  completionAuditorMaxTokens: z.number().step(1).min(1).default(4096),
  completionAuditorMaxAttemptsPerTurn: z.number().step(1).min(1).default(2),
  completionAuditorReportMaxCharacters: z.number().step(1).min(1).default(6000),
})

/** Fully materialized tool policy. */
interface ResolvedConfig {
  readonly blockedAfterConsecutiveRounds: number
  readonly completionRequiresCompletedTodos: boolean
  readonly completionAuditor?: CompletionAuditorConfig
}

type UpdateAction = 'edit' | 'pause' | 'resume' | 'complete' | 'blocked'

const UPDATE_ACTIONS: UpdateAction[] = ['edit', 'pause', 'resume', 'complete', 'blocked']

const CREATE_DESCRIPTION =
  'Create one persisted same-session completion goal when the current direct human request '
  + 'is a long-running objective that should continue across autonomous goal rounds. You may '
  + 'infer that intent without requiring the user to say "create a goal". Do not use this for '
  + 'trivial single-turn work. Execution rejects non-human and subagent authority.'

const GET_DESCRIPTION =
  'Read the current same-session goal, including its exact id/revision, objective, phase, completed '
  + 'continuation rounds, round limit, blocker reason when present, and whether another continuation is armed. '
  + 'Call this before updating a goal.'

/** Canonical goal-tool output, matching the existing compact Native JSON. */
type GoalToolValue =
  | { goal: null }
  | {
    goal: {
      id: string
      revision: number
      objective: string
      phase: GoalView['phase']
      roundsStarted: number
      maxGoalRounds: number
      blockedReason?: { code: string; message: string }
    }
    activation: GoalView['activation']
  }

const GOAL_VALUE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: { type: 'null', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            id: { type: 'string', required: true },
            revision: { type: 'integer', required: true },
            objective: { type: 'string', required: true },
            phase: { type: 'string', required: true, enum: ['active', 'paused', 'blocked', 'complete'] },
            roundsStarted: { type: 'integer', required: true },
            maxGoalRounds: { type: 'integer', required: true },
            blockedReason: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
        activation: { type: 'string', required: true, enum: ['armed', 'disarmed'] },
      },
    },
  ],
} as const

/** Render policy guidance with its deployment-selected blocked threshold. */
function guidance(
  blockedAfter: number,
  completionRequiresCompletedTodos: boolean,
  completionAuditorEnabled: boolean,
): string {
  return 'Use goal tools for one long-running completion objective in the current session. '
    + 'create_goal may infer goal intent from a direct human request in any language; do not '
    + 'create a goal for routine single-turn work. A deployment may create the goal automatically '
    + 'for an accepted implementation task, so call get_goal before create_goal or update_goal and copy its '
    + 'exact goal_id and revision. After session resume or fork, an active goal is disarmed: when '
    + 'a human asks to continue or resume in any wording or language, use update_goal action '
    + 'resume to rearm it. Mark complete only when the objective is actually achieved. Mark '
    + `blocked only after the same blocking condition persists for at least ${blockedAfter} `
    + 'consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, '
    + 'or useful remaining work is not blocked.'
    + (completionRequiresCompletedTodos
      ? ' Completion is rejected until this goal has a non-empty todo_write list and every item is completed.'
      : '')
    + (completionAuditorEnabled
      ? ' A complete request starts an independent workspace audit. Rejection keeps the goal active and returns '
        + 'actionable findings; correct them and revalidate before requesting completion again.'
      : '')
}

/** Resolve one optional normalized string from Loader or direct apply input. */
function optionalConfigString(name: string, value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  if (value !== value.trim()) throw new TypeError(`${name} must not have leading or trailing whitespace`)
  return value
}

/** Require one configured positive safe integer. */
function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  return value
}

/** Validate config even when apply is called directly outside Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const blockedAfter = config.blockedAfterConsecutiveRounds ?? 3
  positiveSafeInteger('blockedAfterConsecutiveRounds', blockedAfter)
  const provider = optionalConfigString('completionAuditorProvider', config.completionAuditorProvider)
  const modelProvider = optionalConfigString(
    'completionAuditorModelProvider',
    config.completionAuditorModelProvider,
  )
  const model = optionalConfigString('completionAuditorModel', config.completionAuditorModel)
  if (provider === undefined && (modelProvider !== undefined || model !== undefined)) {
    throw new TypeError('completionAuditorProvider is required when an auditor model route is configured')
  }
  if ((modelProvider === undefined) !== (model === undefined)) {
    throw new TypeError('completionAuditorModelProvider and completionAuditorModel must be configured together')
  }
  return {
    blockedAfterConsecutiveRounds: blockedAfter,
    completionRequiresCompletedTodos: config.completionRequiresCompletedTodos ?? false,
    ...provider === undefined ? {} : {
      completionAuditor: {
        provider,
        ...modelProvider === undefined ? {} : { modelProvider },
        ...model === undefined ? {} : { model },
        maxTokens: positiveSafeInteger(
          'completionAuditorMaxTokens',
          config.completionAuditorMaxTokens ?? 4096,
        ),
        maxAttemptsPerTurn: positiveSafeInteger(
          'completionAuditorMaxAttemptsPerTurn',
          config.completionAuditorMaxAttemptsPerTurn ?? 2,
        ),
        reportMaxCharacters: positiveSafeInteger(
          'completionAuditorReportMaxCharacters',
          config.completionAuditorReportMaxCharacters ?? 6000,
        ),
      },
    },
  }
}

/** Latest whole task list written after this goal's create mutation. */
function currentGoalTodos(agent: GoalToolExecution['agent'], goal: GoalView): readonly TodoItem[] | undefined {
  const events = agent.session.events
  const createdAt = events.findLastIndex(event => event.type === 'goal/change'
    && event.data.operation === 'create' && event.data.goal.id === goal.id)
  if (createdAt < 0) return undefined
  const write = events.slice(createdAt + 1).findLast(event => event.type === 'todo/write')
  return write?.type === 'todo/write' ? write.data.todos : undefined
}

/** Enforce the deployment's durable task-state prerequisite before a goal can become complete. */
function requireCompletedTodos(execution: GoalToolExecution, goal: GoalView): void {
  const todos = currentGoalTodos(execution.agent, goal)
  if (todos === undefined || todos.length === 0) {
    throw new HarnessError(
      'complete requires a non-empty todo_write list for the current goal',
      'GOAL_TOOL_TODOS_REQUIRED',
    )
  }
  const remaining = todos.filter(todo => todo.status !== 'completed')
  if (remaining.length === 0) return
  const summary = remaining.slice(0, 3).map(todo => todo.content).join('; ')
  throw new HarnessError(
    `complete rejected: ${remaining.length} todo item(s) remain incomplete${summary === '' ? '' : `: ${summary}`}`,
    'GOAL_TOOL_TODOS_INCOMPLETE',
  )
}

/** Whether optional text is meaningful rather than a strict-schema empty filler. */
function hasText(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/** Whether an optional round cap is meaningful rather than a strict-schema zero filler. */
function hasRoundCap(value: number | undefined): value is number {
  return value !== undefined && value !== 0
}

/** Build the exact compare-and-set ref from model arguments. */
function goalRef(goalId: string, revision: number): GoalRef {
  if (goalId.length === 0 || goalId !== goalId.trim()
    || !Number.isSafeInteger(revision) || revision < 1) {
    throw new HarnessError(
      'goal_id must be non-empty and revision must be a positive safe integer',
      'GOAL_TOOL_INVALID_UPDATE',
    )
  }
  return { id: GoalId(goalId), revision }
}

/** Stable compact model result; activation is an observation, not replay state. */
function goalValue(goal: GoalView | undefined): GoalToolValue {
  if (goal === undefined) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...goal.blockedReason === undefined ? {} : {
        blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message },
      },
    },
    activation: goal.activation,
  }
}

/** Reusable canonical output declaration for all three goal controls. */
const GOAL_OUTPUT = {
  schema: GOAL_VALUE_SCHEMA,
  render: (_args: unknown, value: GoalToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Generic, args-only pending presentation shared by the goal tools. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Register the three Codex-shaped goal tools and their shared policy section. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const auditAttempts = new CompletionAuditAttempts()
  ctx.systemPrompt.section({
    name: 'tool:goal',
    order: 114,
    text: guidance(
      resolved.blockedAfterConsecutiveRounds,
      resolved.completionRequiresCompletedTodos,
      resolved.completionAuditor !== undefined,
    ),
  })

  ctx.tools.register(defineTool({
    name: 'get_goal',
    description: GET_DESCRIPTION,
    parameters: {},
    output: GOAL_OUTPUT,
    execute(_args, exec) {
      const execution = goalToolExecution(ctx, exec)
      return Promise.resolve(goalValue(ctx.goals.get(execution.agent)))
    },
    presentCall: () => present('Read current goal', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'create_goal',
    description: CREATE_DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The concrete completion objective inferred from the direct human request.',
      },
      max_goal_rounds: {
        type: 'number',
        description: 'Optional positive safe-integer limit on automatic continuation rounds.',
      },
    },
    output: GOAL_OUTPUT,
    execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      requireDirectHuman(ctx, execution)
      const goal = ctx.goals.create(execution.agent, {
        objective: args.objective,
        ...args.max_goal_rounds === undefined ? {} : { maxGoalRounds: args.max_goal_rounds },
      })
      return Promise.resolve(goalValue(goal))
    },
    presentCall: args => present('Create goal', 'other', args.objective),
  }))

  ctx.tools.register(defineTool({
    name: 'update_goal',
    description: 'Update the exact current goal revision. edit, pause, and resume require a direct '
      + 'top-level human request. During an automatic continuation of the current goal, complete '
      + 'and blocked are also allowed. blocked is rejected before the configured minimum round count; the model remains '
      + 'responsible for judging that the same condition persisted across those rounds and must explain it in blocked_reason.',
    parameters: {
      goal_id: { type: 'string', required: true, description: 'Exact id returned by get_goal.' },
      revision: { type: 'number', required: true, description: 'Exact positive revision returned by get_goal.' },
      action: {
        type: 'string',
        required: true,
        enum: UPDATE_ACTIONS,
        description: 'edit | pause | resume | complete | blocked',
      },
      objective: { type: 'string', description: 'Replacement objective; valid only with action edit.' },
      max_goal_rounds: { type: 'number', description: 'Replacement cap; valid only with action edit.' },
      blocked_reason: {
        type: 'string',
        description: 'Concrete blocking condition; required only with action blocked.',
      },
    },
    output: GOAL_OUTPUT,
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      const ref = goalRef(args.goal_id, args.revision)
      const replacements = {
        ...hasText(args.objective) ? { objective: args.objective } : {},
        ...hasRoundCap(args.max_goal_rounds) ? { maxGoalRounds: args.max_goal_rounds } : {},
      }
      if (args.action === 'edit') {
        requireDirectHuman(ctx, execution)
        if (hasText(args.blocked_reason)) {
          throw new HarnessError('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
        }
        const goal = ctx.goals.edit(execution.agent, ref, replacements)
        return Promise.resolve(goalValue(goal))
      }
      if (args.action === 'pause' || args.action === 'resume') {
        requireDirectHuman(ctx, execution)
        if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds) || hasText(args.blocked_reason)) {
          throw new HarnessError(
            'objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked',
            'GOAL_TOOL_INVALID_UPDATE',
          )
        }
        const goal = args.action === 'pause'
          ? ctx.goals.pause(execution.agent, ref)
          : ctx.goals.resume(execution.agent, ref)
        return Promise.resolve(goalValue(goal))
      }
      const authority = completionAuthority(ctx, execution)
      if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds)) {
        throw new HarnessError(
          'objective and max_goal_rounds are valid only with action edit',
          'GOAL_TOOL_INVALID_UPDATE',
        )
      }
      if (args.action === 'complete' && hasText(args.blocked_reason)) {
        throw new HarnessError('blocked_reason is valid only with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
      }
      if (args.action === 'blocked'
        && (args.blocked_reason === undefined || args.blocked_reason.trim().length === 0)) {
        throw new HarnessError('blocked_reason is required with action blocked', 'GOAL_TOOL_INVALID_UPDATE')
      }
      if (args.action === 'blocked' && authority.kind === 'goal-round'
        && authority.goal.roundsStarted < resolved.blockedAfterConsecutiveRounds) {
        throw new HarnessError(
          `blocked requires at least ${resolved.blockedAfterConsecutiveRounds} consecutive goal rounds; `
          + `current round is ${authority.goal.roundsStarted}`,
          'GOAL_TOOL_BLOCK_THRESHOLD',
        )
      }
      if (args.action === 'complete' && resolved.completionRequiresCompletedTodos) {
        const current = authority.kind === 'goal-round' ? authority.goal : ctx.goals.get(execution.agent)
        if (current === undefined) throw new HarnessError('no current goal exists', 'GOAL_NOT_FOUND')
        requireCompletedTodos(execution, current)
      }
      if (args.action === 'complete' && resolved.completionAuditor !== undefined) {
        const current = authority.kind === 'goal-round' ? authority.goal : ctx.goals.get(execution.agent)
        if (current === undefined) throw new HarnessError('no current goal exists', 'GOAL_NOT_FOUND')
        if (current.id !== ref.id || current.revision !== ref.revision) {
          throw new HarnessError('goal revision is stale; call get_goal and retry', 'GOAL_STALE_REVISION')
        }
        auditAttempts.reserve(
          execution.agent,
          execution.start.data.turn,
          resolved.completionAuditor.maxAttemptsPerTurn,
        )
        await requireCompletionAudit(
          ctx,
          execution.agent,
          current,
          currentGoalTodos(execution.agent, current),
          resolved.completionAuditor,
          exec.signal,
        )
      }
      const goal = args.action === 'complete'
        ? ctx.goals.complete(execution.agent, ref)
        : ctx.goals.block(execution.agent, ref, {
          code: 'model-reported',
          message: args.blocked_reason as string,
        })
      if (authority.kind === 'goal-round') {
        exec.deferContext(createUserMessage({
          content: args.action === 'complete'
            ? renderWrapupContext(goal.objective)
            : renderWrapupContext(goal.objective, args.blocked_reason as string),
          source: {
            kind: 'plugin',
            plugin: 'tool-goal',
            form: 'notice',
            summary: boundContextSummary(`${args.action as string}: ${goal.objective}`),
          },
        }))
      }
      return Promise.resolve(goalValue(goal))
    },
    presentCall: args => present(
      args.action === 'complete' && resolved.completionAuditor !== undefined
        ? 'Verify delivery'
        : `${args.action === 'blocked' ? 'Mark' : args.action.charAt(0).toUpperCase() + args.action.slice(1)} goal`,
      'other',
      hasText(args.blocked_reason)
        ? args.blocked_reason
        : hasText(args.objective)
          ? args.objective
          : hasRoundCap(args.max_goal_rounds) ? args.max_goal_rounds : args.goal_id,
    ),
  }))
}
