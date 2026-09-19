/**
 * Quarantined preview helpers: historical reports can be rendered, never promoted or persisted.
 * Runtime learning requires native session evidence and the existing approval pipeline.
 * @module @deepseek-ai/dsh-experimental-agent-team/coordinator-evolution
 */
import type { LeonBlackboard } from './blackboard.ts'

/** Unverified historical report fields, not approved memory or measured runtime results. */
export interface CoordinatorInsight {
  missionId: string
  timestamp: number
  outcome: 'completed' | 'blocked' | 'cancelled'
  totalTasks: number
  completedTasks: number
  blockedTasks: number
  totalFindings: number
  lessonsLearned: readonly string[]
  recommendedFutureStrategy: string
}

/**
 * Reject post-mortems from a plan that carries no durable execution evidence.
 * @param _blackboard Ephemeral preview, not an execution log.
 * @param _outcome Unverified requested outcome.
 * @returns Never; throws before producing any claimed lesson.
 */
export function generatePostMortem(
  _blackboard: LeonBlackboard,
  _outcome: 'completed' | 'blocked' | 'cancelled',
): CoordinatorInsight {
  throw new Error('COLLECTIVE_RUNTIME_UNAVAILABLE: a planning preview cannot generate verified experience.')
}

/**
 * Render a historical or caller-supplied report as unverified data for inspection only.
 * @param insight Unverified report; its claims are not independently validated here.
 * @returns Text that explicitly disclaims execution, review and memory approval.
 */
export function formatPostMortemMarkdown(insight: CoordinatorInsight): string {
  return [
    `### Unverified Preview Report: ${insight.missionId}`,
    'UNVERIFIED DATA — not proof of execution, independent review or approved memory.',
    `- Claimed outcome: ${insight.outcome}`,
    `- Claimed delivered tasks: ${insight.completedTasks} / ${insight.totalTasks}`,
    `- Claimed findings: ${insight.totalFindings}`,
    '- Unverified suggestions:',
    ...insight.lessonsLearned.map(lesson => `  - ${lesson}`),
    `- Unverified strategy: ${insight.recommendedFutureStrategy}`,
  ].join('\n')
}

/**
 * Reject persistence from this preview without creating directories or touching existing JSONL.
 * @param _insight Unverified preview data, never approved memory.
 * @param _targetJsonlPath Requested path, which remains untouched.
 * @returns Rejected promise explaining the unavailable evidence and approval integration.
 */
export function persistInsight(_insight: CoordinatorInsight, _targetJsonlPath: string): Promise<void> {
  return Promise.reject(new Error('COLLECTIVE_RUNTIME_UNAVAILABLE: preview insights cannot be persisted or promoted to memory.'))
}

/** Inspection helpers with experience generation and persistence deliberately unavailable. */
export const CoordinatorEvolution = {
  generatePostMortem,
  formatPostMortemMarkdown,
  persistInsight,
} as const
