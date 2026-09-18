/**
 * In-memory task-plan preview, never an execution or evidence authority.
 * Runtime task ownership, review and recovery belong to the native TeamService.
 * @module @deepseek-ai/dsh-experimental-agent-team/blackboard
 */
import { randomUUID } from 'node:crypto'

/** Legacy report states; the planning preview emits only pending. */
export type BlackboardTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'review_ready'
  | 'completed'
  | 'blocked'

/** Unverified historical rejection fields, not a native reviewer authorization. */
export interface BlackboardRejection {
  rejectedBy: string
  reason: string
  expected: string
  observed: string
  timestamp: number
}

/** Preview or legacy report fields; these values never authorize execution. */
export interface BlackboardTask {
  id: string
  title: string
  description: string
  assignedTo: string | null
  status: BlackboardTaskStatus
  dependsOn: readonly string[]
  acceptanceCriteria: readonly string[]
  writeScopes: readonly string[]
  attempts: number
  maxAttempts: number
  deliveryEvidence: string | null
  lastRejection: BlackboardRejection | null
  createdAt: number
  updatedAt: number
}

/** Unverified historical finding fields; preview APIs cannot create findings. */
export interface BlackboardFinding {
  id: string
  author: string
  topic: string
  content: string
  timestamp: number
}

/** Independent ephemeral plan copy, not a durable session projection. */
export interface BlackboardSnapshot {
  missionId: string
  tasks: readonly BlackboardTask[]
  findings: readonly BlackboardFinding[]
}

/** Metadata for a proposed task, without runtime permissions or ownership. */
export interface CreateTaskParams {
  id?: string | undefined
  title: string
  description: string
  dependsOn?: readonly string[] | undefined
  acceptanceCriteria?: readonly string[] | undefined
  assignedTo?: string | undefined
  writeScopes?: readonly string[] | undefined
  maxAttempts?: number | undefined
}

/**
 * Holds only an ephemeral plan. Reusing a mission id does not recover a session.
 * Operational methods always reject, including direct calls outside the CLI.
 */
export class LeonBlackboard {
  private readonly tasks = new Map<string, BlackboardTask>()

  constructor(public readonly missionId: string = randomUUID()) {}

  /**
   * Add a pending plan item without creating any runtime task or permission.
   * @param params Proposed task metadata.
   * @returns An independent copy of the planned item.
   */
  createTask(params: CreateTaskParams): BlackboardTask {
    const id = params.id ?? `task-${randomUUID().slice(0, 8)}`
    if (this.tasks.has(id)) throw new Error(`Task ${id} already exists on the plan`)
    const task: BlackboardTask = {
      id,
      title: params.title.trim(),
      description: params.description.trim(),
      assignedTo: params.assignedTo?.trim() ?? null,
      status: 'pending',
      dependsOn: [...params.dependsOn ?? []],
      acceptanceCriteria: [...params.acceptanceCriteria ?? []],
      writeScopes: [...params.writeScopes ?? []],
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      deliveryEvidence: null,
      lastRejection: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.tasks.set(id, task)
    return structuredClone(task)
  }

  /**
   * Reject unverified discoveries; this preview has no persisted actor or session.
   * @param _author Unverified display name.
   * @param _topic Claimed discovery topic.
   * @param _content Claimed discovery content.
   * @returns Never; throws without changing the plan.
   */
  postFinding(_author: string, _topic: string, _content: string): BlackboardFinding {
    return this.unavailable()
  }

  /**
   * Reject task execution; ownership is authoritative only in the native TeamService.
   * @param _taskId Proposed task id.
   * @param _agentName Unverified display name.
   * @returns Never; throws without assigning ownership or consuming attempts.
   */
  claimTask(_taskId: string, _agentName: string): BlackboardTask {
    return this.unavailable()
  }

  /**
   * Reject delivery claims; this preview cannot establish artifact or verifier provenance.
   * @param _taskId Proposed task id.
   * @param _agentName Unverified display name.
   * @param _evidence Unverified delivery claim.
   * @returns Never; throws without accepting evidence or changing the plan.
   */
  submitDelivery(_taskId: string, _agentName: string, _evidence: string): BlackboardTask {
    return this.unavailable()
  }

  /**
   * Reject review mutations; callers cannot appoint themselves as reviewers here.
   * @param _taskId Proposed task id.
   * @param _reviewerName Unverified display name.
   * @param _feedback Unverified review claim.
   * @returns Never; throws without accepting review or changing the plan.
   */
  rejectDelivery(
    _taskId: string,
    _reviewerName: string,
    _feedback: { reason: string; expected: string; observed: string },
  ): BlackboardTask {
    return this.unavailable()
  }

  /**
   * Reject completion without changing the plan, regardless of the supplied reviewer name.
   * @param _taskId Proposed task id.
   * @param _reviewerName Unverified display name.
   * @returns Never; throws without authorizing completion.
   */
  completeTask(_taskId: string, _reviewerName: string): BlackboardTask {
    return this.unavailable()
  }

  /**
   * List dependency-free plan items, not admitted work.
   * @returns Independent copies of items without planned prerequisites.
   */
  getReadyTasks(): readonly BlackboardTask[] {
    return [...this.tasks.values()].filter(task => task.dependsOn.length === 0).map(task => structuredClone(task))
  }

  /**
   * Read an independent plan snapshot. Findings remain empty because execution is unavailable.
   * @returns Pending task metadata and no execution evidence.
   */
  read(): BlackboardSnapshot {
    return { missionId: this.missionId, tasks: [...this.tasks.values()].map(task => structuredClone(task)), findings: [] }
  }

  private unavailable(): never {
    throw new Error('COLLECTIVE_RUNTIME_UNAVAILABLE: LeonBlackboard is a planning-only preview; use the native TeamService for persisted tasks, host identity and review.')
  }
}
