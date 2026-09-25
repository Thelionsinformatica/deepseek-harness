import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { evaluateSubagentEvidence, assertEvidenceTools } from '../src/evidence.ts'
import { foldSubagentDescriptor, snapshotSubagentDescriptor } from '../src/descriptor.ts'
import { settleRun } from '../src/run-settlement.ts'

const start: SessionEvent<'turn/start'> = { type: 'turn/start', seq: 10, time: 0, data: { turn: 2 } }
const call: SessionEvent<'tool/call'> = {
  type: 'tool/call', seq: 11, time: 0,
  data: { turn: 2, step: 0, callId: CallId('own-read'), name: 'read', arguments: '{}' },
}
const result: SessionEvent<'tool/result'> = {
  type: 'tool/result', seq: 12, time: 0, surfaceOp: 'append', sourceEventSeqs: [11],
  data: { turn: 2, step: 0, message: createToolResultMessage({ callId: CallId('own-read'), content: [], isError: false }) },
}

describe('host-owned subagent evidence fold', () => {
  it('opts out for ordinary work and marks an unsubstantiated audit explicitly', () => {
    expect(evaluateSubagentEvidence([start], undefined)).toBeUndefined()
    expect(evaluateSubagentEvidence([], ['read'])).toEqual({
      status: 'missing', semanticVerification: 'unverified', tools: ['read'], calls: [],
    })
  })

  it('counts one exact pair once, without claiming semantic correctness', () => {
    expect(evaluateSubagentEvidence([start, call, result, { ...result, seq: 13 }], ['read'])).toEqual({
      status: 'observed', semanticVerification: 'unverified', tools: ['read'],
      calls: [{ tool: 'read', callId: 'own-read', callSeq: 11, resultSeq: 12 }],
    })
  })

  it.each([
    ['failed result', { ...result, data: { ...result.data, message: createToolResultMessage({ callId: CallId('own-read'), content: [], isError: true }) } }],
    ['host error', { ...result, data: { ...result.data, error: { name: 'Error', code: 'DENIED' } } }],
    ['foreign call id', { ...result, data: { ...result.data, message: createToolResultMessage({ callId: CallId('foreign'), content: [], isError: false }) } }],
    ['foreign turn', { ...result, data: { ...result.data, turn: 1 } }],
    ['foreign step', { ...result, data: { ...result.data, step: 1 } }],
    ['foreign source', { ...result, sourceEventSeqs: [1] }],
    ['multiple sources', { ...result, sourceEventSeqs: [11, 1] }],
    ['missing sources', { ...result, sourceEventSeqs: [] }],
    ['result before call', { ...result, seq: 9 }],
    ['replace event', { ...result, surfaceOp: { op: 'replace', start: 0, end: 1 } }],
  ] satisfies [string, SessionEvent<'tool/result'>][])('rejects %s as proof of a successful own execution', (_label, candidate) => {
    expect(evaluateSubagentEvidence([start, call, candidate], ['read'])?.status).toBe('missing')
  })

  it('rejects streams, unmatched calls, inherited results and duplicate ambiguous call ids', () => {
    expect(evaluateSubagentEvidence([start, call], ['read'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([start, result], ['read'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([start, call, result], ['grep'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([start, call, { ...call, seq: 13 }, result], ['read'])?.status).toBe('missing')
    const chunk: SessionEvent<'assistant/chunk'> = {
      type: 'assistant/chunk', seq: 11, time: 0,
      data: { turn: 2, step: 0, chunk: { type: 'text-delta', index: 0, text: 'I called read successfully.' } },
    }
    expect(evaluateSubagentEvidence([start, chunk], ['read'])?.status).toBe('missing')
  })

  it('requires a new pair in the newest turn and a new turn after the activation boundary', () => {
    expect(evaluateSubagentEvidence([start, call, result, { ...start, seq: 14, data: { turn: 3 } }], ['read'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([call, result], ['read'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([
      start, { ...call, data: { ...call.data, turn: 1 } }, { ...result, data: { ...result.data, turn: 1 } },
    ], ['read'])?.status).toBe('missing')
    expect(evaluateSubagentEvidence([
      start, { ...call, seq: 1 }, { ...result, sourceEventSeqs: [1] },
    ], ['read'])?.status).toBe('missing')
  })

  it.each([[], ['read', 'read'], [''], [' read'], [1], null, 'read', Array.from({ length: 65 }, (_, i) => `tool${i}`)])(
    'rejects invalid host configuration %j', (value) => {
      expect(() => { assertEvidenceTools(value) }).toThrow('evidenceTools')
    },
  )

  it('preserves v2 ordinary sessions and strictly persists v3 policy without later overwrite', () => {
    const tools = ['read', 'grep']
    const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'audit', evidenceTools: tools })
    tools.splice(0)
    expect(descriptor).toMatchObject({ version: 3, evidenceTools: ['read', 'grep'] })
    const event = (data: unknown) => ({ type: 'subagent/descriptor', seq: 0, time: 0, data }) as SessionEvent<'subagent/descriptor'>
    expect(foldSubagentDescriptor([event(descriptor), event({ ...descriptor, evidenceTools: ['write'] })])).toEqual(descriptor)
    expect(snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn' }).version).toBe(2)
    for (const value of [
      { ...descriptor, version: 2 }, { ...descriptor, evidenceTools: [] },
      { ...descriptor, evidenceTools: undefined }, { ...descriptor, selfApproved: true },
    ]) expect(() => foldSubagentDescriptor([event(value)])).toThrow()
  })

  it('does not publish an unsupported completed audit as a successful background job', async () => {
    const evidence = evaluateSubagentEvidence([start], ['read'])!
    const actual = { stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'everything passed' }], evidence }
    const outcome = await settleRun({ id: SessionId('audit'), localAgent: undefined, result: Promise.resolve(actual), dispose: () => Promise.resolve() })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('SUBAGENT_EVIDENCE_MISSING')
    expect(actual.stopReason).toBe('completed')
    expect(actual.output[0]?.text).toBe('everything passed')
  })
})
