import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CoordinatorEvolution,
  LeonBlackboard,
  LeonExecutive,
} from '../src/index.ts'

describe('Leon Executive, Blackboard and Coordinator Evolution', () => {
  it('manages task DAG lifecycle, dependency blocking, and deliveries on the blackboard', () => {
    const blackboard = new LeonBlackboard('mission-test-01')

    const task1 = blackboard.createTask({
      id: 'task-inspect',
      title: 'Inspect legacy imports',
      description: 'Find duplicated policy keys',
      acceptanceCriteria: ['Must extract digest of import-policy.json'],
    })

    const task2 = blackboard.createTask({
      id: 'task-fix',
      title: 'Update policy to upsert',
      description: 'Apply idempotent import policy',
      dependsOn: ['task-inspect'],
      acceptanceCriteria: ['Policy must be upsert'],
    })

    expect(task1.status).toBe('pending')
    expect(task2.status).toBe('pending')

    // Task 2 cannot be claimed before Task 1 is completed
    expect(() => blackboard.claimTask('task-fix', 'coder-agent')).toThrow(/dependency task-inspect is not completed/)

    // Claim Task 1
    const claimed1 = blackboard.claimTask('task-inspect', 'researcher-agent')
    expect(claimed1.status).toBe('in_progress')
    expect(claimed1.assignedTo).toBe('researcher-agent')

    // Submit Delivery with evidence
    const delivered1 = blackboard.submitDelivery(
      'task-inspect',
      'researcher-agent',
      'Digest 3f8a9e1b matches legacy duplicate',
    )
    expect(delivered1.status).toBe('review_ready')
    expect(delivered1.deliveryEvidence).toContain('Digest 3f8a9e1b')

    // Complete Task 1
    const completed1 = blackboard.completeTask('task-inspect', 'reviewer-agent')
    expect(completed1.status).toBe('completed')

    // Now Task 2 is available and its dependencies are satisfied
    const readyTasks = blackboard.getReadyTasks()
    expect(readyTasks.map(t => t.id)).toContain('task-fix')

    const claimed2 = blackboard.claimTask('task-fix', 'coder-agent')
    expect(claimed2.status).toBe('in_progress')

    // Post shared findings
    const finding = blackboard.postFinding(
      'researcher-agent',
      'import-policy-digest',
      'Found duplicated record in schema line 42',
    )
    expect(finding.author).toBe('researcher-agent')

    const snapshot = blackboard.read()
    expect(snapshot.tasks).toHaveLength(2)
    expect(snapshot.findings).toHaveLength(1)
  })

  it('orchestrates mission initialization and executive synthesis via LeonExecutive', () => {
    const blackboard = new LeonBlackboard('mission-exec-02')
    const executive = new LeonExecutive(blackboard)

    executive.initializeMission({
      objective: 'Refactor database models safely',
      successCriteria: ['All migrations verified', 'Zero downtime observed'],
      decomposedTasks: [
        {
          title: 'Database Schema Audit',
          description: 'Inspect tables',
          suggestedRole: 'researcher',
          acceptanceCriteria: ['List all active indexes'],
        },
        {
          title: 'Execute Migration',
          description: 'Add new column',
          suggestedRole: 'coder',
          acceptanceCriteria: ['Column present and populated'],
        },
      ],
    })

    const snapshot = blackboard.read()
    expect(snapshot.tasks).toHaveLength(2)
    expect(executive.isMissionReadyForSynthesis()).toBe(false)

    // Complete both tasks
    for (const task of snapshot.tasks) {
      blackboard.claimTask(task.id, 'worker')
      blackboard.submitDelivery(task.id, 'worker', 'Execution verified OK')
      blackboard.completeTask(task.id, 'executive')
    }

    expect(executive.isMissionReadyForSynthesis()).toBe(true)

    blackboard.postFinding('reviewer', 'audit-summary', 'All migration scripts passed idempotency check.')
    const synthesis = executive.generateExecutiveSynthesis()

    expect(synthesis).toContain('# Executive Mission Synthesis')
    expect(synthesis).toContain('Database Schema Audit')
    expect(synthesis).toContain('All migration scripts passed idempotency check.')
  })

  it('generates post-mortem insights and persists lessons learned for coordinator evolution', async () => {
    const blackboard = new LeonBlackboard('mission-evolution-03')
    blackboard.createTask({
      id: 'task-a',
      title: 'Analyze Network Rules',
      description: 'Audit egress ports',
    })
    blackboard.claimTask('task-a', 'worker')
    blackboard.submitDelivery('task-a', 'worker', 'No external egress found')
    blackboard.completeTask('task-a', 'reviewer')
    blackboard.postFinding('worker', 'security-note', 'Port 443 strictly bounded to loopback.')

    const insight = CoordinatorEvolution.generatePostMortem(blackboard, 'completed')
    expect(insight.outcome).toBe('completed')
    expect(insight.totalTasks).toBe(1)
    expect(insight.completedTasks).toBe(1)
    expect(insight.totalFindings).toBe(1)
    expect(insight.lessonsLearned.length).toBeGreaterThan(0)

    const markdown = CoordinatorEvolution.formatPostMortemMarkdown(insight)
    expect(markdown).toContain('Post-Mortem Report: mission-evolution-03')
    expect(markdown).toContain('**Outcome:** COMPLETED')

    // Test file persistence
    const tempDir = await mkdtemp(join(tmpdir(), 'leon-evolution-'))
    const insightFile = join(tempDir, 'insights.jsonl')
    try {
      await CoordinatorEvolution.persistInsight(insight, insightFile)
      const content = await readFile(insightFile, 'utf8')
      const parsed = JSON.parse(content.trim()) as { missionId: string; outcome: string }
      expect(parsed.missionId).toBe('mission-evolution-03')
      expect(parsed.outcome).toBe('completed')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('supports AgentCoder iterative feedback loop: rejection with expected vs observed and rework', () => {
    const blackboard = new LeonBlackboard('mission-agentcoder-04')
    const task = blackboard.createTask({
      id: 'task-auth-patch',
      title: 'Fix auth token validation',
      description: 'Require bearer token on endpoint',
      assignedTo: 'coder-agent',
      writeScopes: ['packages/auth/src'],
      maxAttempts: 3,
      acceptanceCriteria: ['Return 401 when token is missing'],
    })

    expect(task.attempts).toBe(0)
    expect(task.writeScopes).toContain('packages/auth/src')

    // 1st attempt: Coder claims and delivers
    blackboard.claimTask('task-auth-patch', 'coder-agent')
    expect(blackboard.read().tasks[0].attempts).toBe(1)
    blackboard.submitDelivery('task-auth-patch', 'coder-agent', 'Added check for Authorization header')

    // Reviewer tests and finds a defect (AgentCoder pattern)
    const rejected = blackboard.rejectDelivery('task-auth-patch', 'reviewer-agent', {
      reason: 'Token was checked but malformed header causes 500 instead of 401',
      expected: 'HTTP 401 Unauthorized',
      observed: 'HTTP 500 Internal Server Error',
    })

    expect(rejected.status).toBe('in_progress')
    expect(rejected.lastRejection?.expected).toBe('HTTP 401 Unauthorized')
    expect(rejected.lastRejection?.observed).toBe('HTTP 500 Internal Server Error')

    // A shared finding is posted to the blackboard automatically
    const snapshot = blackboard.read()
    const qaFinding = snapshot.findings.find(f => f.topic === 'qa_rejection')
    expect(qaFinding).toBeDefined()
    expect(qaFinding?.content).toContain('Esperado: HTTP 401 Unauthorized')

    // 2nd attempt: Coder adjusts and resubmits
    blackboard.claimTask('task-auth-patch', 'coder-agent')
    expect(blackboard.read().tasks[0].attempts).toBe(2)
    blackboard.submitDelivery('task-auth-patch', 'coder-agent', 'Added try-catch to return 401 on malformed tokens')

    // Reviewer tests again and now passes
    const completed = blackboard.completeTask('task-auth-patch', 'reviewer-agent')
    expect(completed.status).toBe('completed')
  })

  it('triggers circuit breaker and blocks task when maxAttempts is reached', () => {
    const blackboard = new LeonBlackboard('mission-circuitbreaker-05')
    blackboard.createTask({
      id: 'task-fragile',
      title: 'Fragile operation',
      description: 'Test limit',
      assignedTo: 'coder-agent',
      maxAttempts: 2,
    })

    // 1st attempt
    blackboard.claimTask('task-fragile', 'coder-agent')
    blackboard.submitDelivery('task-fragile', 'coder-agent', 'Fix 1')
    blackboard.rejectDelivery('task-fragile', 'reviewer-agent', {
      reason: 'Fail 1',
      expected: 'Pass',
      observed: 'Fail',
    })

    // 2nd attempt (hits maxAttempts = 2)
    blackboard.claimTask('task-fragile', 'coder-agent')
    blackboard.submitDelivery('task-fragile', 'coder-agent', 'Fix 2')
    const blocked = blackboard.rejectDelivery('task-fragile', 'reviewer-agent', {
      reason: 'Fail 2 again',
      expected: 'Pass',
      observed: 'Fail',
    })

    expect(blocked.status).toBe('blocked')
    expect(() => blackboard.claimTask('task-fragile', 'coder-agent')).toThrow(/blocked due to excessive rejections/)
  })
})
