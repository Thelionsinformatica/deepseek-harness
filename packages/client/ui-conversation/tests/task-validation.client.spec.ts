import { describe, expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationEventInput, ConversationViewDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { readTaskValidation, taskValidationPhase, taskValidationDefinition, type TaskValidationState } from '../src/client/conversation-nodes/task-validation.ts'

describe('explicit task validation presentation', () => {
  it('does not show success before the turn completes', () => {
    expect(taskValidationPhase({ turn: 1, seq: 10, attempt: 1, status: 'passed' })).toBe('checking')
  })
  it('shows a validated criterion only after completed plus passed', () => {
    expect(taskValidationPhase({ turn: 1, seq: 10, attempt: 2, status: 'passed', ended: 'completed' })).toBe('validated')
  })
  it('does not approve cancelled or failed work even after a pass', () => {
    expect(taskValidationPhase({ turn: 1, seq: 10, attempt: 2, status: 'passed', ended: 'other' })).toBe('unvalidated')
  })
  it('shows correction only while the turn remains open', () => {
    expect(taskValidationPhase({ turn: 1, seq: 10, attempt: 1, status: 'retry' })).toBe('correcting')
    expect(taskValidationPhase({ turn: 1, seq: 10, attempt: 1, status: 'retry', ended: 'completed' })).toBe('unvalidated')
  })
  it('ignores normal completion and malformed decisions', () => {
    expect(readTaskValidation({ type: 'turn/end', seq: 10, data: { turn: 1 } })).toBeUndefined()
    expect(readTaskValidation({ type: 'task/validation', seq: 10, data: { turn: 1, attempt: 0, status: 'passed' } })).toBeUndefined()
  })

  it('reconstructs the same final status from live events and replay', () => {
    const view: ConversationViewDefinition = {
      target: 'chat',
      create: () => {
        let nodes: ConversationViewNode[] = []
        return {
          empty: nodes,
          replace: change => (nodes = [...change.nodes]),
          apply: (change) => {
            for (const node of change.upserts) nodes = [...nodes.filter(n => n.key !== node.key), node]
            return nodes
          },
        }
      },
    }
    const create = () => new ConversationNodeAssembler(
      { entries: () => [taskValidationDefinition], fallbackEntry: () => undefined },
      { entries: () => [view] },
    )
    const event = (seq: number, type: string, data: unknown): ConversationEventInput => ({
      event: { seq, time: seq, type, data } as SessionEvent, view: undefined,
    })
    const events = [
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'task/validation', { turn: 1, attempt: 1, status: 'retry' }),
      event(2, 'task/validation', { turn: 1, attempt: 2, status: 'passed' }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const live = create()
    live.replaceWindow(events.slice(0, 3), false)
    live.flush()
    const state = (assembler: ConversationNodeAssembler) => ((assembler.snapshot('chat') as ConversationViewNode[])[0]!.data as TaskValidationState)
    expect(taskValidationPhase(state(live))).toBe('checking')
    live.append(events[3]!)
    live.flush()
    expect(taskValidationPhase(state(live))).toBe('validated')
    const replay = create()
    replay.replaceWindow(events, false)
    replay.flush()
    expect(state(replay)).toEqual(state(live))
  })
})
