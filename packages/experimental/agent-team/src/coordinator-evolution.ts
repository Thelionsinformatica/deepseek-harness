/**
 * Coordinator Evolution & Post-Mortem system: captures multi-agent performance
 * metrics, coordination efficacy, and reusable organizational knowledge.
 * @module @deepseek-ai/dsh-experimental-agent-team/coordinator-evolution
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LeonBlackboard } from './blackboard.ts'

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

/** Analyze blackboard execution facts and derive actionable coordination insights. */
export function generatePostMortem(
  blackboard: LeonBlackboard,
  outcome: 'completed' | 'blocked' | 'cancelled',
): CoordinatorInsight {
  const snapshot = blackboard.read()
  const totalTasks = snapshot.tasks.length
  const completedTasks = snapshot.tasks.filter(task => task.status === 'completed').length
  const blockedTasks = snapshot.tasks.filter(task => task.status === 'blocked').length
  const totalFindings = snapshot.findings.length

  const lessons: string[] = []

  if (totalTasks > 0 && completedTasks === totalTasks) {
    lessons.push('Sequential DAG decomposition succeeded without orphaned tasks.')
  } else if (blockedTasks > 0) {
    lessons.push(`Identified ${blockedTasks} blocked task(s); inspect dependency resolution or strictness.`)
  }

  if (totalFindings === 0) {
    lessons.push('Team did not leverage shared blackboard findings; encourage discovery posting.')
  } else {
    lessons.push(`Team shared ${totalFindings} technical discoveries across sessions.`)
  }

  let strategy = 'Continue standard DAG decomposition with explicit acceptance criteria.'
  if (outcome === 'blocked') {
    strategy = 'Incorporate preliminary exploratory spike before committing to downstream dependencies.'
  } else if (completedTasks >= 3) {
    strategy = 'Maintain tiered specialist delegation (investigation -> execution -> review).'
  }

  return {
    missionId: snapshot.missionId,
    timestamp: Date.now(),
    outcome,
    totalTasks,
    completedTasks,
    blockedTasks,
    totalFindings,
    lessonsLearned: lessons,
    recommendedFutureStrategy: strategy,
  }
}

/** Render an operational summary ready for human audit or long-term memory ingestion. */
export function formatPostMortemMarkdown(insight: CoordinatorInsight): string {
  return [
    `### Post-Mortem Report: ${insight.missionId}`,
    `- **Outcome:** ${insight.outcome.toUpperCase()}`,
    `- **Tasks Delivered:** ${insight.completedTasks} / ${insight.totalTasks}`,
    `- **Shared Findings:** ${insight.totalFindings}`,
    '- **Lessons Learned:**',
    ...insight.lessonsLearned.map(lesson => `  - ${lesson}`),
    `- **Recommended Future Strategy:** ${insight.recommendedFutureStrategy}`,
  ].join('\n')
}

/** Persist the operational insight as append-only JSONL into Leon memory storage. */
export async function persistInsight(insight: CoordinatorInsight, targetJsonlPath: string): Promise<void> {
  await mkdir(dirname(targetJsonlPath), { recursive: true })
  const entry = `${JSON.stringify(insight)}\n`
  await appendFile(targetJsonlPath, entry, 'utf8')
}

export const CoordinatorEvolution = {
  generatePostMortem,
  formatPostMortemMarkdown,
  persistInsight,
} as const
