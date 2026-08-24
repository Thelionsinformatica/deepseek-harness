import { describe, expect, it } from 'vitest'
import {
  evaluateCandidatePolicy,
  type CandidatePolicyContext,
} from '../src/policy.ts'

describe('candidate memory policy', () => {
  it('is deterministic for identical candidate inputs', () => {
    const input: CandidatePolicyContext = {
      operation: 'memory_recall',
      query: 'Qual é a porta da dashboard?',
      total: 4,
      omittedSensitive: 0,
      inserted: 3,
      confidence: 0.9,
      topScore: 0.95,
    }
    const first = evaluateCandidatePolicy(input)
    const second = evaluateCandidatePolicy(input)
    expect(first).toEqual(second)
  })

  it('blocks explicit credential-like queries and marks blocked as decision', () => {
    const blocked = evaluateCandidatePolicy({
      operation: 'tool_call_memory_search',
      query: 'Use this token sk-proj-abcdef1234567890abcdef',
      total: 3,
      omittedSensitive: 0,
      inserted: 3,
      confidence: 0.9,
      topScore: 0.9,
    })

    expect(blocked).toMatchObject({
      policyVersion: 1,
      decision: 'block',
      reason: 'credential-signal',
    })
  })

  it('rejects candidate snapshots with no candidates', () => {
    const rejected = evaluateCandidatePolicy({
      operation: 'memory_recall',
      query: 'não encontrei nada',
      total: 0,
      omittedSensitive: 0,
      inserted: 0,
      confidence: 0,
      topScore: 0,
    })

    expect(rejected).toMatchObject({
      policyVersion: 1,
      decision: 'reject',
      reason: 'no-candidates',
    })
  })

  it('confirms sensitive contexts for review even with usable candidates', () => {
    const confirmed = evaluateCandidatePolicy({
      operation: 'tool_call_memory_search',
      query: 'Compartilhe o token de acesso do banco.',
      total: 6,
      omittedSensitive: 1,
      inserted: 5,
      confidence: 0.9,
      topScore: 0.83,
    })

    expect(confirmed).toMatchObject({
      policyVersion: 1,
      decision: 'confirm',
      reason: 'sensitivity-review-required',
    })
  })

  it('can promote high-confidence technical facts to store', () => {
    const store = evaluateCandidatePolicy({
      operation: 'memory_recall',
      query: 'Qual é a porta de produção usada no projeto leon?',
      total: 2,
      omittedSensitive: 0,
      inserted: 2,
      confidence: 0.92,
      topScore: 0.88,
    })

    expect(store.decision).toBe('store')
    expect(store.reason).toBe('high-confidence')
  })
})
