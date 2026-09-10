/**
 * Shared Blackboard for multi-agent coordination: central state for DAG tasks,
 * verifiable acceptance criteria, peer discoveries and evidence tracking.
 * @module @deepseek-ai/dsh-experimental-agent-team/blackboard
 */

import { randomUUID } from 'node:crypto'

export type BlackboardTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'review_ready'
  | 'completed'
  | 'blocked'

export interface BlackboardTask {
  id: string
  title: string
  description: string
  assignedTo: string | null
  status: BlackboardTaskStatus
  dependsOn: readonly string[]
  acceptanceCriteria: readonly string[]
  deliveryEvidence: string | null
  createdAt: number
  updatedAt: number
}

export interface BlackboardFinding {
  id: string
  author: string
  topic: string
  content: string
  timestamp: number
}

export interface BlackboardSnapshot {
  missionId: string
  tasks: readonly BlackboardTask[]
  findings: readonly BlackboardFinding[]
}

export interface CreateTaskParams {
  id?: string | undefined
  title: string
  description: string
  dependsOn?: readonly string[] | undefined
  acceptanceCriteria?: readonly string[] | undefined
  assignedTo?: string | undefined
}

export class LeonBlackboard {
  private readonly tasks = new Map<string, BlackboardTask>()
  private readonly findings: BlackboardFinding[] = []

  constructor(public readonly missionId: string = randomUUID()) {}

  /** Create a new task with explicit dependencies and acceptance criteria. */
  createTask(params: CreateTaskParams): BlackboardTask {
    const id = params.id ?? `task-${randomUUID().slice(0, 8)}`
    if (this.tasks.has(id)) {
      throw new Error(`Task ${id} already exists on the blackboard`)
    }
    const task: BlackboardTask = {
      id,
      title: params.title.trim(),
      description: params.description.trim(),
      assignedTo: params.assignedTo?.trim() ?? null,
      status: 'pending',
      dependsOn: params.dependsOn ? [...params.dependsOn] : [],
      acceptanceCriteria: params.acceptanceCriteria ? [...params.acceptanceCriteria] : [],
      deliveryEvidence: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.tasks.set(id, task)
    return { ...task }
  }

  /** Post a shared technical discovery, artifact digest or log excerpt to the blackboard. */
  postFinding(author: string, topic: string, content: string): BlackboardFinding {
    const finding: BlackboardFinding = {
      id: `find-${randomUUID().slice(0, 8)}`,
      author: author.trim(),
      topic: topic.trim(),
      content: content.trim(),
      timestamp: Date.now(),
    }
    this.findings.push(finding)
    return { ...finding }
  }

  /** Worker claims an available task. Dependencies must be completed before start. */
  claimTask(taskId: string, agentName: string): BlackboardTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status === 'completed') throw new Error(`Task ${taskId} is already completed`)
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId)
      if (!dep || dep.status !== 'completed') {
        throw new Error(`Cannot claim ${taskId}: dependency ${depId} is not completed`)
      }
    }
    task.assignedTo = agentName.trim()
    task.status = 'in_progress'
    task.updatedAt = Date.now()
    return { ...task }
  }

  /** Worker delivers the result with concrete verification evidence. */
  submitDelivery(taskId: string, agentName: string, evidence: string): BlackboardTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.assignedTo !== agentName.trim()) {
      throw new Error(`Task ${taskId} is assigned to ${task.assignedTo}, not ${agentName}`)
    }
    if (!evidence.trim()) {
      throw new Error(`Delivery of ${taskId} requires non-empty evidence`)
    }
    task.deliveryEvidence = evidence.trim()
    task.status = 'review_ready'
    task.updatedAt = Date.now()
    return { ...task }
  }

  /** Reviewer or Coordinator approves and closes the task. */
  completeTask(taskId: string, _reviewerName: string): BlackboardTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'review_ready' && task.status !== 'in_progress') {
      throw new Error(`Task ${taskId} must be in review_ready or in_progress to be completed`)
    }
    task.status = 'completed'
    task.updatedAt = Date.now()
    return { ...task }
  }

  /** Return all tasks whose dependencies are satisfied and ready for work. */
  getReadyTasks(): readonly BlackboardTask[] {
    const ready: BlackboardTask[] = []
    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue
      const satisfied = task.dependsOn.every(depId => this.tasks.get(depId)?.status === 'completed')
      if (satisfied) ready.push({ ...task })
    }
    return ready
  }

  /** Read an immutable snapshot of current blackboard state. */
  read(): BlackboardSnapshot {
    return {
      missionId: this.missionId,
      tasks: Array.from(this.tasks.values()).map(task => ({ ...task })),
      findings: [...this.findings],
    }
  }
}
