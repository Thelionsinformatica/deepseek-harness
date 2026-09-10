/**
 * Leon Executive: technical orchestrator guidelines, mission breakdown contracts,
 * and high-level leadership protocols for the primary reasoning model.
 * @module @deepseek-ai/dsh-experimental-agent-team/executive
 */

import type { BlackboardTask, LeonBlackboard } from './blackboard.ts'

export const AGENT_ROLES = {
  EXECUTIVE: 'lead-supervisor',
  RESEARCHER: 'researcher-agent',
  CODER: 'coder-agent',
  CHECKER: 'reviewer-agent',
} as const

export interface RolePermissions {
  readonly canWriteFiles: boolean
  readonly canRunTests: boolean
  readonly canModifyDag: boolean
}

export const ROLE_PERMISSIONS: Record<keyof typeof AGENT_ROLES, RolePermissions> = {
  EXECUTIVE: { canWriteFiles: false, canRunTests: false, canModifyDag: true },
  RESEARCHER: { canWriteFiles: false, canRunTests: false, canModifyDag: false },
  CODER: { canWriteFiles: true, canRunTests: true, canModifyDag: false },
  CHECKER: { canWriteFiles: false, canRunTests: true, canModifyDag: false },
}

export interface DecomposedTaskSpec {
  title: string
  description: string
  suggestedRole: 'researcher' | 'coder' | 'tester' | 'reviewer'
  dependsOn?: string[] | undefined
  acceptanceCriteria: string[]
  writeScopes?: string[] | undefined
  maxAttempts?: number | undefined
}

export interface MissionStrategy {
  objective: string
  decomposedTasks: DecomposedTaskSpec[]
  successCriteria: string[]
}

/** Executive system guidance ensuring the coordinator delegates rather than executing directly. */
export const LEON_EXECUTIVE_SYSTEM_PROMPT = `
You are LEON_EXECUTIVE, the Technical Lead and Orchestrator of the multi-agent collective.
Your primary responsibility is strategic coordination, high-level problem decomposition, and final synthesis.

Core Operating Principles:
1. DELEGATE, DO NOT SELF-EXECUTE: Do not write detailed implementations or run trial-and-error operations yourself.
   Assign concrete tasks with explicit acceptance criteria to specialist teammates.
2. CONSULT THE BLACKBOARD: Read findings and digests submitted by your team before making state decisions.
3. DEPENDENCY AWARENESS: Order tasks logically (Research/Inspection -> Implementation -> Independent Verification).
4. VERIFIABLE EVIDENCE: Never mark an objective completed without verifiable evidence provided by the designated reviewer.
5. CONCISE DIRECTION: Give clear, unambiguous task assignments. Avoid endless conversational back-and-forth.
`.trim()

export class LeonExecutive {
  constructor(public readonly blackboard: LeonBlackboard) {}

  /** Initialize a mission on the blackboard with structured tasks and dependency DAG. */
  initializeMission(strategy: MissionStrategy): readonly BlackboardTask[] {
    const createdTasks: BlackboardTask[] = []
    for (const spec of strategy.decomposedTasks) {
      const task = this.blackboard.createTask({
        title: spec.title,
        description: spec.description,
        ...spec.dependsOn !== undefined ? { dependsOn: spec.dependsOn } : {},
        acceptanceCriteria: spec.acceptanceCriteria,
        ...spec.writeScopes !== undefined ? { writeScopes: spec.writeScopes } : {},
        ...spec.maxAttempts !== undefined ? { maxAttempts: spec.maxAttempts } : {},
      })
      createdTasks.push(task)
    }
    return createdTasks
  }

  /**
   * Determine whether the mission is ready for final executive synthesis.
   * All mandatory tasks must be in completed status and verified.
   */
  isMissionReadyForSynthesis(): boolean {
    const snapshot = this.blackboard.read()
    if (snapshot.tasks.length === 0) return false
    return snapshot.tasks.every(task => task.status === 'completed')
  }

  /** Generate an executive synthesis summarizing delivered findings and task evidence. */
  generateExecutiveSynthesis(): string {
    const snapshot = this.blackboard.read()
    const taskSummary = snapshot.tasks.map(task =>
      `- [${task.id}] ${task.title}: ${task.status} (Evidence: ${task.deliveryEvidence ?? 'N/A'})`,
    ).join('\n')

    const findingsSummary = snapshot.findings.map(finding =>
      `- [${finding.author} on ${finding.topic}]: ${finding.content}`,
    ).join('\n')

    return [
      '# Executive Mission Synthesis',
      `Mission ID: ${snapshot.missionId}`,
      '\n## Delivered Tasks:',
      taskSummary || 'No tasks registered.',
      '\n## Team Findings & Evidence:',
      findingsSummary || 'No shared findings recorded.',
    ].join('\n')
  }
}
