import { describe, expect, it } from 'vitest'
import { MemoryId, type MemoryRecord, type MemorySearchHit } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { rankMemoryHits, resolveRankingConfig } from '../src/ranking.ts'

const workspaceId = WorkspaceId('ranking-workspace')
const otherWorkspaceId = WorkspaceId('ranking-other')
const now = Date.parse('2026-08-25T12:00:00.000Z')

function hit(
  id: string,
  score: number,
  overrides: Partial<MemoryRecord> = {},
): MemorySearchHit {
  return {
    score,
    record: {
      id: MemoryId(id),
      scope: { workspaceId },
      content: `memory ${id}`,
      revision: 1,
      source: { kind: 'session', sessionId: SessionId(`session-${id}`) },
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
      ...overrides,
    },
  }
}

describe('deterministic final memory ranking', () => {
  it('orders identical relevance by recency, importance, validation, then stable id', () => {
    const ranked = rankMemoryHits([
      hit('legacy', 1),
      hit('important', 1, { importance: 1 }),
      hit('reviewed-z', 1, {
        importance: 1,
        validation: 'reviewed',
        confidence: 1,
        updatedAt: '2026-08-24T12:00:00.000Z',
      }),
      hit('reviewed-a', 1, {
        importance: 1,
        validation: 'reviewed',
        confidence: 1,
        updatedAt: '2026-08-24T12:00:00.000Z',
      }),
    ], workspaceId, 8, resolveRankingConfig(), now)

    expect(ranked.map(item => item.record.id)).toEqual([
      MemoryId('reviewed-a'),
      MemoryId('reviewed-z'),
      MemoryId('important'),
      MemoryId('legacy'),
    ])
  })

  it('deduplicates by id, retains the strongest revision, and caps the final result', () => {
    const ranked = rankMemoryHits([
      hit('duplicate', 0.4, { revision: 1 }),
      hit('duplicate', 0.9, { revision: 2, content: 'newer duplicate' }),
      hit('second', 0.8),
      hit('third', 0.7),
    ], workspaceId, 2, resolveRankingConfig(), now)

    expect(ranked).toHaveLength(2)
    expect(ranked[0]).toMatchObject({ record: { id: MemoryId('duplicate'), revision: 2 } })
    expect(new Set(ranked.map(item => item.record.id)).size).toBe(2)
  })

  it('uses every deterministic duplicate tie-break without letting weaker rows replace stronger ones', () => {
    const ranked = rankMemoryHits([
      hit('revision-wins', 0.9, { revision: 1 }),
      hit('revision-wins', 0.4, { revision: 2, content: 'revision two' }),
      hit('score-wins', 0.4, { revision: 1 }),
      hit('score-wins', 0.8, { revision: 1, content: 'higher score' }),
      hit('date-wins', 0.8, { updatedAt: '2026-08-01T12:00:00.000Z' }),
      hit('date-wins', 0.8, { updatedAt: '2026-08-02T12:00:00.000Z', content: 'newer date' }),
      hit('weaker-stays-out', 0.9, { revision: 2, content: 'strong current' }),
      hit('weaker-stays-out', 1, { revision: 1, content: 'weaker revision' }),
      hit('equal-stays-out', 0.9, { updatedAt: '2026-08-02T12:00:00.000Z', content: 'new current' }),
      hit('equal-stays-out', 0.9, { updatedAt: '2026-08-01T12:00:00.000Z', content: 'older candidate' }),
    ], workspaceId, 20, resolveRankingConfig({ enabled: false }), now)

    expect(ranked.find(item => item.record.id === MemoryId('revision-wins'))?.record.content).toBe('revision two')
    expect(ranked.find(item => item.record.id === MemoryId('score-wins'))?.record.content).toBe('higher score')
    expect(ranked.find(item => item.record.id === MemoryId('date-wins'))?.record.content).toBe('newer date')
    expect(ranked.find(item => item.record.id === MemoryId('weaker-stays-out'))?.record.content).toBe('strong current')
    expect(ranked.find(item => item.record.id === MemoryId('equal-stays-out'))?.record.content).toBe('new current')
  })

  it('handles zero relevance and explicit validation without manufacturing a provider score', () => {
    const ranked = rankMemoryHits([
      hit('legacy', 0),
      hit('explicit', -1, { validation: 'explicit', confidence: 1 }),
    ], workspaceId, 8, resolveRankingConfig(), now)

    expect(ranked[0]?.record.id).toBe(MemoryId('explicit'))
    expect(ranked.every(item => Number.isFinite(item.score) && item.score > 0)).toBe(true)
  })

  it('drops invalid, non-finite, empty, and cross-workspace provider output', () => {
    const ranked = rankMemoryHits([
      hit('valid', 1),
      hit('cross-scope', 99, { scope: { workspaceId: otherWorkspaceId } }),
      hit('nan-score', Number.NaN),
      hit('empty', 1, { content: '   ' }),
      hit('bad-date', 1, { updatedAt: 'not-a-date' }),
      hit('bad-revision', 1, { revision: 0 }),
      hit('bad-importance', 1, { importance: 2 }),
      hit('bad-confidence', 1, { confidence: -1 }),
      hit('bad-validation', 1, { validation: 'unknown' as 'reviewed' }),
    ], workspaceId, 20, resolveRankingConfig(), now)

    expect(ranked).toMatchObject([{ record: { id: MemoryId('valid') } }])
  })

  it('can roll back to deterministic provider-score ordering', () => {
    const ranked = rankMemoryHits([
      hit('b', 1, { updatedAt: '2026-08-24T12:00:00.000Z', importance: 1, validation: 'reviewed' }),
      hit('a', 2),
    ], workspaceId, 8, resolveRankingConfig({ enabled: false }), now)

    expect(ranked.map(item => item.record.id)).toEqual([MemoryId('a'), MemoryId('b')])
    expect(ranked.map(item => item.score)).toEqual([2, 1])
  })

  it.each([
    [{ halfLifeDays: 0 }, 'halfLifeDays'],
    [{ relevanceWeight: -1 }, 'relevanceWeight'],
    [{ recencyWeight: Number.NaN }, 'recencyWeight'],
    [{ importanceWeight: -1 }, 'importanceWeight'],
    [{ validationWeight: -1 }, 'validationWeight'],
    [{ relevanceWeight: 0, recencyWeight: 0, importanceWeight: 0, validationWeight: 0 }, 'cannot all be zero'],
  ] as const)('rejects invalid ranking configuration %j', (input, message) => {
    expect(() => resolveRankingConfig(input)).toThrow(message)
  })
})
