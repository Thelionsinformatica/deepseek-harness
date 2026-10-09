import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  MAX_EVIDENCE_ARGUMENT_CHARS,
  MAX_EVIDENCE_CALLS,
  procedureEvidenceDefinition,
  toolMemoryRecallDefinition,
  type ProcedureEvidenceState,
  type ToolMemoryRecallState,
} from '../src/session-facts.ts'

/** Build a committed event; the fold reads only type, seq, time, data, and surfaceOp. */
function event(seq: number, type: string, data: unknown, surfaceOp?: unknown): SessionEvent {
  return { seq, time: 1_000 + seq, type, data, ...surfaceOp === undefined ? {} : { surfaceOp } } as unknown as SessionEvent
}

function snapshot(seq: number, kind: string, section: string, text: string, surfaceOp: unknown = 'append'): SessionEvent {
  return event(seq, 'user/message', {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind, form: 'snapshot', sections: [{ name: section, text }] },
  }, surfaceOp)
}

function human(seq: number, text: string): SessionEvent {
  return event(seq, 'user/message', { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, 'append')
}

function foldRecall(events: readonly SessionEvent[]): ToolMemoryRecallState {
  return events.reduce(toolMemoryRecallDefinition.apply, toolMemoryRecallDefinition.init())
}

function foldEvidence(events: readonly SessionEvent[]): ProcedureEvidenceState {
  return events.reduce(procedureEvidenceDefinition.apply, procedureEvidenceDefinition.init())
}

describe('toolMemoryRecall projection', () => {
  it('records owned snapshots and the latest direct-human text', () => {
    const state = foldRecall([human(1, 'primeiro'), snapshot(2, 'tool-memory', 'memory:recall', 'fato'), human(3, 'segundo')])
    expect(state.latestHumanText).toBe('segundo')
    expect(state.slots).toEqual([{ seq: 2, section: 'memory:recall', text: 'fato' }])
  })

  it('treats the migrated legacy kind plugin:tool-memory as owned', () => {
    const state = foldRecall([snapshot(4, 'plugin:tool-memory', 'personal-memory:core', 'perfil')])
    expect(state.slots).toEqual([{ seq: 4, section: 'personal-memory:core', text: 'perfil' }])
  })

  it('ignores snapshots from other producers and keeps the same state reference', () => {
    const initial = toolMemoryRecallDefinition.init()
    expect(toolMemoryRecallDefinition.apply(initial, snapshot(5, 'time-context', 'memory:recall', 'x'))).toBe(initial)
    expect(toolMemoryRecallDefinition.apply(initial, event(6, 'turn/start', { turn: 1 }))).toBe(initial)
  })

  it('drops slots that a positional replacement removed from the surface', () => {
    const state = foldRecall([
      snapshot(2, 'tool-memory', 'memory:recall', 'antigo'),
      snapshot(9, 'tool-memory', 'memory:recall', 'novo', { op: 'replace', startSeq: 2, endSeq: 2 }),
    ])
    expect(state.slots).toEqual([{ seq: 9, section: 'memory:recall', text: 'novo' }])
  })
})

describe('toolMemoryProcedureEvidence projection', () => {
  const call = (seq: number, callId: string, args = '{"path":"x"}') =>
    event(seq, 'tool/call', { turn: 1, step: 1, callId, name: 'probe', arguments: args })
  const result = (seq: number, callId: string, isError = false) =>
    event(seq, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, isError, content: [] } }, 'append')

  it('pairs a call with its later result as a content-free digest', () => {
    const state = foldEvidence([event(1, 'turn/start', { turn: 1 }), call(2, 'c1'), result(3, 'c1')])
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]).toMatchObject({ callId: 'c1', arguments: '{"path":"x"}', ambiguous: false, resultAmbiguous: false })
    expect(state.calls[0]?.result).toMatchObject({ isError: false, time: 1_003 })
    expect(state.calls[0]?.result?.digest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('marks duplicate call ids and duplicate results as ambiguous', () => {
    const state = foldEvidence([call(1, 'c1'), call(2, 'c1'), result(3, 'c1'), result(4, 'c1')])
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]).toMatchObject({ ambiguous: true, resultAmbiguous: true })
  })

  it('keeps only the latest calls and drops oversized arguments', () => {
    const events = Array.from({ length: MAX_EVIDENCE_CALLS + 2 }, (_, i) => call(i + 1, `c${i}`))
    events.push(call(500, 'big', 'x'.repeat(MAX_EVIDENCE_ARGUMENT_CHARS + 1)))
    const state = foldEvidence(events)
    expect(state.calls).toHaveLength(MAX_EVIDENCE_CALLS)
    expect(state.calls.some(entry => entry.callId === 'c0')).toBe(false)
    expect(state.calls.at(-1)).toMatchObject({ callId: 'big', arguments: null })
  })

  it('tracks direct-human text only while a turn is open', () => {
    const open = foldEvidence([event(1, 'turn/start', { turn: 1 }), human(2, '/procedure-review x')])
    expect(open.openTurnHumanText).toBe('/procedure-review x')
    const closed = procedureEvidenceDefinition.apply(open, event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(closed.openTurnHumanText).toBeNull()
    expect(procedureEvidenceDefinition.apply(closed, human(4, 'fora do turno'))).toBe(closed)
  })
})
