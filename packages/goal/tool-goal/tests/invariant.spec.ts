import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GoalId } from '@deepseek-ai/dsh-goal'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolGoalInvariant from '@deepseek-ai/dsh-tool-goal/invariant'
import {
  captureCompletionEvidence,
  completionAuditReceipt,
} from '../src/completion-evidence.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ToolGoalInvariant)
  return ctx
}

/** Append one canonical current goal and return the minimal view needed by evidence capture. */
function currentGoal(session: ReturnType<Context['sessions']['create']>) {
  const id = GoalId('goal-under-audit')
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: {
      id,
      revision: 1,
      objective: 'deliver verified behavior',
      phase: 'active',
      maxGoalRounds: 10,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  return { id, revision: 1 }
}

const auditor = {
  provider: 'audit',
  modelProvider: 'ollama',
  model: 'ornith-1.5-9b',
  maxTokens: 2048,
  maxAttemptsPerTurn: 2,
  reportMaxCharacters: 2000,
}

const inheritedAuditor = {
  provider: 'audit',
  maxTokens: 2048,
  maxAttemptsPerTurn: 2,
  reportMaxCharacters: 2000,
}

describe('tool-goal completion evidence invariant', () => {
  it('accepts a content-free receipt bound to the exact current goal history', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('valid-goal-audit'))
    session.append('turn/start', { turn: 1 })
    const goal = currentGoal(session)
    session.append('todo/write', { todos: [{ content: 'run tests', status: 'completed' }] })
    const receipt = completionAuditReceipt(
      captureCompletionEvidence(session, goal), inheritedAuditor, 1, 'auditor-session-1', 'a'.repeat(64),
    )

    expect(() => session.append('goal/completion-audit', receipt)).not.toThrow()
    expect(session.events.at(-1)).toMatchObject({
      type: 'goal/completion-audit',
      data: { goal, completedTodoCount: 1 },
    })
  })

  it('rejects a tampered digest before durable publication', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('tampered-goal-audit'))
    session.append('turn/start', { turn: 1 })
    const goal = currentGoal(session)
    const receipt = completionAuditReceipt(
      captureCompletionEvidence(session, goal), auditor, 0, 'auditor-session-2', 'b'.repeat(64),
    )
    const before = session.seq

    expect(() => session.append('goal/completion-audit', {
      ...receipt,
      evidence: { ...receipt.evidence, digest: '0'.repeat(64) },
    })).toThrow(/digest does not match committed history/)
    expect(session.seq).toBe(before)
  })

  it('rejects receipts outside a turn and receipts for stale goal revisions', async () => {
    const ctx = await setup()
    const outside = ctx.sessions.create(SessionId('outside-turn-goal-audit'))
    outside.append('turn/start', { turn: 1 })
    const outsideGoal = currentGoal(outside)
    outside.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const outsideReceipt = completionAuditReceipt(
      captureCompletionEvidence(outside, outsideGoal),
      auditor,
      0,
      'auditor-session-3',
      'c'.repeat(64),
    )
    expect(() => outside.append('goal/completion-audit', outsideReceipt))
      .toThrow(/outside any open turn/)

    const stale = ctx.sessions.create(SessionId('stale-goal-audit'))
    stale.append('turn/start', { turn: 1 })
    const staleGoal = currentGoal(stale)
    const staleReceipt = completionAuditReceipt(
      captureCompletionEvidence(stale, staleGoal),
      auditor,
      0,
      'auditor-session-4',
      'd'.repeat(64),
    )
    expect(() => stale.append('goal/completion-audit', {
      ...staleReceipt,
      goal: { ...staleReceipt.goal, revision: 2 },
    })).toThrow(/does not name the exact current incomplete goal revision/)
  })
})
