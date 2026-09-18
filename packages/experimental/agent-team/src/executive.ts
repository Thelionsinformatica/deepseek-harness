/**
 * Leon Executive: technical orchestrator guidelines, mission breakdown contracts,
 * and high-level leadership protocols for the primary reasoning model.
 * @module @deepseek-ai/dsh-experimental-agent-team/executive
 */

import type { BlackboardTask, LeonBlackboard } from './blackboard.ts'

/** Suggested display labels, never persisted identities or authorization roles. */
export const AGENT_ROLES = {
  EXECUTIVE: 'lead-supervisor',
  RESEARCHER: 'researcher-agent',
  CODER: 'coder-agent',
  CHECKER: 'reviewer-agent',
} as const

/** Proposed permission descriptions, not enforced grants. */
export interface RolePermissions {
  readonly canWriteFiles: boolean
  readonly canRunTests: boolean
  readonly canModifyDag: boolean
}

/** Planning reference only; native host policies own executable permissions. */
export const ROLE_PERMISSIONS: Record<keyof typeof AGENT_ROLES, RolePermissions> = {
  EXECUTIVE: { canWriteFiles: false, canRunTests: false, canModifyDag: true },
  RESEARCHER: { canWriteFiles: false, canRunTests: false, canModifyDag: false },
  CODER: { canWriteFiles: true, canRunTests: true, canModifyDag: false },
  CHECKER: { canWriteFiles: false, canRunTests: true, canModifyDag: false },
}

/** Proposed task breakdown used only for an ephemeral plan. */
export interface DecomposedTaskSpec {
  title: string
  description: string
  suggestedRole: 'researcher' | 'coder' | 'tester' | 'reviewer'
  dependsOn?: string[] | undefined
  acceptanceCriteria: string[]
  writeScopes?: string[] | undefined
  maxAttempts?: number | undefined
}

/** Unexecuted objective and proposed task metadata. */
export interface MissionStrategy {
  objective: string
  decomposedTasks: DecomposedTaskSpec[]
  successCriteria: string[]
}

/** Proposed guidance only; this preview does not mount a runtime prompt or enforce permissions. */
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

/** Ephemeral plan presenter, not a model coordinator or execution runtime. */
export class LeonExecutive {
  constructor(public readonly blackboard: LeonBlackboard) {}

  /**
   * Create an ephemeral task plan; no runtime session or teammate is initialized.
   * @param strategy Proposed mission metadata.
   * @returns Independent copies of pending plan items.
   */
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
   * Refuse runtime completion because this preview has no persisted verification evidence.
   * @returns Always false; a plan cannot authorize mission completion.
   */
  isMissionReadyForSynthesis(): boolean {
    return false
  }

  /**
   * Render only planned tasks, without claiming execution, evidence or review.
   * @returns Text explicitly identifying the plan as not executed.
   */
  generateExecutiveSynthesis(): string {
    const snapshot = this.blackboard.read()
    const taskSummary = snapshot.tasks.map(task =>
      `- [${task.id}] ${task.title}: ${task.status} (Evidence: ${task.deliveryEvidence ?? 'N/A'})`,
    ).join('\n')

    return [
      '# Executive Plan Preview — NOT EXECUTED',
      `Mission ID: ${snapshot.missionId}`,
      'No runtime sessions, tools, tests or review were executed.',
      '\n## Planned Tasks:',
      taskSummary || 'No tasks registered.',
    ].join('\n')
  }
}
