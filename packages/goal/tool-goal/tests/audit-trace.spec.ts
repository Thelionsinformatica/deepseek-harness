import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { auditExecutionTrace } from '../src/audit-trace.ts'

describe('parent audit trace', () => {
  it('includes committed results without unrelated session data and preserves originals', () => {
    const session = Session.create(SessionId('parent'))
    session.append('turn/start', { turn: 1 })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
      callId: CallId('worker'), content: [{ type: 'text', text: 'SOMA=38' }], isError: false,
    }) }, { surfaceOp: 'append' })
    const before = JSON.stringify(session.events)
    const trace = auditExecutionTrace(session, 24000)
    expect(JSON.parse(trace)).toMatchObject({ complete: true, scope: 'parent-session-only', eventCount: 1 })
    expect(trace).toContain('SOMA=38')
    expect(trace).not.toContain('turn/start')
    expect(JSON.stringify(session.events)).toBe(before)
    expect(auditExecutionTrace(session, trace.length)).toBe(trace)
    expect(JSON.parse(auditExecutionTrace(session, trace.length - 1))).toMatchObject({ complete: false })
  })

  it('does not misrepresent empty or tiny budgets as complete evidence', () => {
    const session = Session.create(SessionId('empty'))
    expect(JSON.parse(auditExecutionTrace(session, 1000))).toMatchObject({ complete: true, eventCount: 0 })
    expect(auditExecutionTrace(session, 1)).toBe('')
  })
})
