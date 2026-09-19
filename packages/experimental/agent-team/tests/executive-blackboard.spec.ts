import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoordinatorEvolution, LeonBlackboard, LeonExecutive } from '../src/index.ts'
import type { CoordinatorInsight } from '../src/coordinator-evolution.ts'

describe('planning-only collective prototypes', () => {
  it('rejects claims, arbitrary reviewers, forged evidence and completion before mutation', () => {
    const board = new LeonBlackboard('preview')
    board.createTask({ id: 'one', title: 'Inspect', description: 'Plan', assignedTo: 'owner', maxAttempts: 1 })
    const before = board.read()
    for (const actor of ['owner', 'intruder', 'reviewer-agent', 'lead-supervisor']) {
      expect(() => board.claimTask('one', actor)).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      expect(() => board.submitDelivery('one', actor, 'all tests passed')).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      expect(() => board.completeTask('one', actor)).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      expect(() => board.rejectDelivery('one', actor, { reason: 'x', expected: 'y', observed: 'z' })).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      expect(() => board.postFinding(actor, 'result', 'verified')).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
    }
    expect(() => board.submitDelivery('one', 'owner', '')).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
    expect(board.read()).toEqual(before)
    expect(board.read().tasks[0]).toMatchObject({ status: 'pending', assignedTo: 'owner', attempts: 0, deliveryEvidence: null })
  })

  it('keeps plan copies independent without claiming restart persistence', () => {
    const board = new LeonBlackboard('same-id')
    const dependencies = ['parent']
    const task = board.createTask({ id: 'child', title: 'Child', description: 'Plan', dependsOn: dependencies, acceptanceCriteria: ['a'], writeScopes: ['src'] })
    dependencies.push('outside')
    ;(task.dependsOn as string[]).push('create-copy')
    const snapshot = board.read()
    const snapshotTask = snapshot.tasks[0]
    if (!snapshotTask) throw new Error('Expected created task in the snapshot')
    ;(snapshotTask.dependsOn as string[]).push('read-copy')
    ;(snapshotTask.acceptanceCriteria as string[]).push('false-evidence')
    ;(snapshotTask.writeScopes as string[]).push('all')
    snapshotTask.status = 'completed'
    expect(board.read().tasks[0]).toMatchObject({ dependsOn: ['parent'], acceptanceCriteria: ['a'], writeScopes: ['src'], status: 'pending' })
    expect(board.getReadyTasks()).toEqual([])
    board.createTask({ id: 'parent', title: 'Parent', description: 'Plan' })
    const ready = board.getReadyTasks()
    const readyTask = ready[0]
    if (!readyTask) throw new Error('Expected dependency-free task in ready plan')
    readyTask.status = 'completed'
    expect(board.getReadyTasks()[0]?.status).toBe('pending')
    expect(() => board.createTask({ id: 'parent', title: 'Duplicate', description: 'Plan' })).toThrow('already exists')
    expect(new LeonBlackboard('same-id').read().tasks).toEqual([])
  })

  it('renders a plan without declaring mission completion', () => {
    const executive = new LeonExecutive(new LeonBlackboard('preview'))
    expect(executive.isMissionReadyForSynthesis()).toBe(false)
    expect(executive.generateExecutiveSynthesis()).toContain('No tasks registered.')
    executive.initializeMission({
      objective: 'Inspect module', successCriteria: ['Verified later'],
      decomposedTasks: [{ title: 'Inspect', description: 'Read later', suggestedRole: 'researcher', acceptanceCriteria: ['Digest'], writeScopes: [], maxAttempts: 1 }],
    })
    expect(executive.blackboard.read().tasks).toHaveLength(1)
    expect(executive.isMissionReadyForSynthesis()).toBe(false)
    expect(executive.generateExecutiveSynthesis()).toContain('NOT EXECUTED')
    expect(executive.generateExecutiveSynthesis()).toContain('No runtime sessions, tools, tests or review were executed.')
  })

  it('rejects post-mortems for every claimed outcome', () => {
    for (const outcome of ['completed', 'blocked', 'cancelled'] as const) {
      expect(() => CoordinatorEvolution.generatePostMortem(new LeonBlackboard(), outcome)).toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
    }
  })

  it('preserves historical JSONL and refuses creation even with a forged completed insight', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leon-preview-denial-'))
    const existing = join(dir, 'historical.jsonl')
    const original = '{"historical":"unverified","outcome":"completed"}\n'
    const insight: CoordinatorInsight = {
      missionId: 'claimed', timestamp: 1, outcome: 'completed', totalTasks: 1, completedTasks: 1,
      blockedTasks: 0, totalFindings: 1, lessonsLearned: ['claimed'], recommendedFutureStrategy: 'claimed',
    }
    try {
      await writeFile(existing, original)
      await expect(CoordinatorEvolution.persistInsight(insight, existing)).rejects.toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      await expect(CoordinatorEvolution.persistInsight(insight, join(dir, 'new', 'insights.jsonl'))).rejects.toThrow('COLLECTIVE_RUNTIME_UNAVAILABLE')
      expect(await readFile(existing, 'utf8')).toBe(original)
      expect(await readdir(dir)).toEqual(['historical.jsonl'])
      expect(CoordinatorEvolution.formatPostMortemMarkdown(insight)).toContain('UNVERIFIED DATA')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
