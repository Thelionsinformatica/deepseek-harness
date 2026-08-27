/**
 * The `sessionStats` projection unit: mounting the plugin beside the
 * projection registry serves whole-log counts and wall times folded from step
 * boundaries, chunks, tool pairs, and assembled messages; compositions
 * without the registry are unaffected; unmounting the plugin removes the key
 * (HMR safety). The two counting regressions pinned here are the reasons the
 * fold counts step boundaries instead of assistant messages: a cancelled step
 * never assembles a message but still counts, and a max-tokens usage-host
 * message (empty content) adds no extra step. Wall-time math runs against the
 * exported definition directly, where event times are controlled.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import {
  createSessionStatsProjectionDefinition,
  sessionStatsProjectionDefinition,
} from '@deepseek-ai/dsh-session-stats/src/projection.ts'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'

async function harness(withStatsPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withStatsPlugin) await ctx.plugin(SessionStatsPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('counted')) }
}

/** Close one step; returns the counted `step/end` seq. */
function closeStep(session: Session, turn: number, step: number): number {
  session.append('step/start', { turn, step })
  return session.append('step/end', { turn, step }).seq
}

/** Append the max-tokens usage-host shape: an assistant/message with empty content. */
function appendEmptyAssistantMessage(session: Session, turn: number, step: number): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

/** The all-zero projection value plus overrides, for exact fold expectations. */
function totals(overrides: Partial<SessionStatsProjection> = {}): SessionStatsProjection {
  return {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    estimatedApiCostUsdNanos: 0, pricedModelCalls: 0, unpricedModelCalls: 0,
    confirmedApiCostUsdNanos: 0, tokenEstimatedApiCostUsdNanos: 0,
    confirmedModelCalls: 0, estimatedModelCalls: 0,
    unaccountedModelCalls: 0, unaccountedModelAttempts: 0,
    ...overrides,
  }
}

describe('sessionStats projection unit (registry drive)', () => {
  it('serves zero figures on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts distinct turns and closed steps and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    session.append('turn/start', { turn: 1 })
    const firstSeq = closeStep(session, 1, 1)
    const secondSeq = closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    const thirdSeq = closeStep(session, 2, 1)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    // Boundary events that carry no figure change (turn/start, empty-prune
    // turn/end, user input) fold to the same reference and stay silent;
    // step/start opens a boundary (internal state) and step/end commits the
    // counts, so each closed step notifies twice with the step/end value last.
    const counted = changes.filter(change => (change.value as SessionStatsProjection).steps > 0
      || change.seq === firstSeq)
    expect(changes.every(change => change.key === 'sessionStats')).toBe(true)
    expect(counted.map(change => ({ seq: change.seq, value: change.value }))).toContainEqual(
      { seq: firstSeq, value: totals({ turns: 1, steps: 1 }) },
    )
    expect(changes.at(-1)).toEqual({ key: 'sessionStats', value: totals({ turns: 2, steps: 3 }), seq: thirdSeq })
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.sessionStats).toEqual(totals({ turns: 2, steps: 3 }))
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
    expect(changes.map(change => change.seq)).toContain(secondSeq)
  })

  it('does not count a rejected or empty turn that closes with no step', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts a cancelled step that closed without an assistant message', async () => {
    // Regression: an aborted stream never assembles assistant/message, but the
    // loop's finally still appends step/end — the step happened and counts.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
  })

  it('adds no extra step for a max-tokens usage-host assistant message', async () => {
    // Regression: the empty-content assistant/message exists only to host
    // usage and is excluded from the surface; the step counts once, from its
    // step/end, while the message contributes only its model wall time.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendEmptyAssistantMessage(session, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1, ttftSteps: 0, decodeTokens: 0 })
  })

  it('folds steps already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(SessionStatsPlugin)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 2 })
  })

  it('has no sessionStats key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionStatsPlugin)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
    await fiber.dispose()
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('sessionStats configured API cost estimate', () => {
  const prices = [
    {
      provider: 'google', model: 'gemini-3.6-flash',
      inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75, cacheReadUsdPerMillion: 0.075,
    },
    {
      provider: 'ollama', model: 'qwen3.5:9b',
      inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    },
  ] as const

  /** Fold events through one explicitly priced projection definition. */
  function foldPriced(events: readonly SessionEvent[]): SessionStatsProjection {
    const definition = createSessionStatsProjectionDefinition(prices)
    const state = events.reduce<Parameters<typeof definition.apply>[0]>(
      (folded, event) => definition.apply(folded, event),
      definition.init(),
    )
    return definition.wire.view(state)
  }

  it('prices exact routes, counts local zero-cost calls, and replaces a stream sample with final usage', () => {
    const cloud = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'cloud' }],
      source: { kind: 'model', provider: 'google', model: 'gemini-3.6-flash' },
    })
    const local = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'local' }],
      source: { kind: 'model', provider: 'ollama', model: 'qwen3.5:9b' },
    })
    const usage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 200 }
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'google', model: 'gemini-3.6-flash' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage } }),
      at(130, 'assistant/message', { turn: 1, step: 1, message: cloud, usage }),
      at(140, 'step/end', { turn: 1, step: 1 }),
      at(200, 'request/header', { header: { config: { provider: 'ollama', model: 'qwen3.5:9b' } } }),
      at(210, 'step/start', { turn: 2, step: 1 }),
      at(220, 'assistant/message', {
        turn: 2, step: 1, message: local, usage: { inputTokens: 50, outputTokens: 10 },
      }),
      at(230, 'step/end', { turn: 2, step: 1 }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 1_140_000,
      pricedModelCalls: 2,
      unpricedModelCalls: 0,
      confirmedApiCostUsdNanos: 0,
      tokenEstimatedApiCostUsdNanos: 1_140_000,
      confirmedModelCalls: 0,
      estimatedModelCalls: 2,
      unaccountedModelCalls: 0,
      unaccountedModelAttempts: 0,
    })
  })

  it('marks a usage-bearing route absent from the table instead of hiding it inside a false total', () => {
    const unknown = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'unknown' }],
      source: { kind: 'model', provider: 'google', model: 'future-model' },
    })
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'google', model: 'future-model' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'assistant/message', {
        turn: 1, step: 1, message: unknown, usage: { inputTokens: 1, outputTokens: 1 },
      }),
      at(130, 'step/end', { turn: 1, step: 1 }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 0,
      pricedModelCalls: 0,
      unpricedModelCalls: 1,
      confirmedApiCostUsdNanos: 0,
      tokenEstimatedApiCostUsdNanos: 0,
      confirmedModelCalls: 0,
      estimatedModelCalls: 0,
      unaccountedModelCalls: 1,
      unaccountedModelAttempts: 0,
    })
  })

  it('prefers an exact gateway-reported charge and treats an explicit zero as priced', () => {
    const gateway = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'gateway' }],
      source: { kind: 'model', provider: 'omniroute', model: 'auto' },
    })
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'omniroute', model: 'auto' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'assistant/message', {
        turn: 1, step: 1, message: gateway,
        usage: { inputTokens: 1_000, outputTokens: 100, providerCostUsdNanos: 42_000 },
      }),
      at(130, 'step/end', { turn: 1, step: 1 }),
      at(210, 'step/start', { turn: 2, step: 1 }),
      at(220, 'assistant/message', {
        turn: 2, step: 1, message: gateway,
        usage: { inputTokens: 10, outputTokens: 1, providerCostUsdNanos: 0 },
      }),
      at(230, 'step/end', { turn: 2, step: 1 }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 42_000,
      pricedModelCalls: 2,
      unpricedModelCalls: 0,
      confirmedApiCostUsdNanos: 42_000,
      tokenEstimatedApiCostUsdNanos: 0,
      confirmedModelCalls: 2,
      estimatedModelCalls: 0,
      unaccountedModelCalls: 0,
      unaccountedModelAttempts: 0,
    })
  })

  it('separates calls without usage from failed attempts without cost evidence', () => {
    const unknown = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'no usage' }],
      source: { kind: 'model', provider: 'google', model: 'future-model' },
    })
    expect(foldPriced([
      at(100, 'step/start', { turn: 1, step: 1 }),
      at(110, 'llm/retry', { turn: 1, step: 1 }),
      at(120, 'llm/retry-started', { turn: 1, step: 1 }),
      at(130, 'llm/retry', { turn: 1, step: 1 }),
      at(140, 'llm/retry-started', { turn: 1, step: 1 }),
      at(150, 'assistant/message', { turn: 1, step: 1, message: unknown }),
      at(160, 'step/end', { turn: 1, step: 1 }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 0,
      pricedModelCalls: 0,
      unpricedModelCalls: 1,
      unaccountedModelCalls: 1,
      unaccountedModelAttempts: 2,
    })
  })

  it('keeps usage from a failed attempt separate from final usage in the same step', () => {
    const cloud = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'recovered' }],
      source: { kind: 'model', provider: 'google', model: 'gemini-3.6-flash' },
    })
    const firstUsage = { inputTokens: 100, outputTokens: 10 }
    const finalUsage = { inputTokens: 200, outputTokens: 20 }
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'google', model: 'gemini-3.6-flash' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: firstUsage } }),
      at(130, 'llm/retry', { turn: 1, step: 1 }),
      at(140, 'assistant/message', { turn: 1, step: 1, message: cloud, usage: finalUsage }),
    ])).toMatchObject({
      tokenEstimatedApiCostUsdNanos: 337_500,
      estimatedModelCalls: 2,
      unaccountedModelAttempts: 0,
    })
  })

  it('counts a no-usage failover attempt separately from its estimated replacement call', () => {
    const cloud = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'fallback' }],
      source: { kind: 'model', provider: 'google', model: 'gemini-3.6-flash' },
    })
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'omniroute', model: 'auto' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'llm/failover', {
        turn: 1, step: 1,
        from: { provider: 'omniroute', model: 'auto' },
        to: { provider: 'google', model: 'gemini-3.6-flash' },
      }),
      at(130, 'request/header', { header: { config: { provider: 'google', model: 'gemini-3.6-flash' } } }),
      at(140, 'assistant/message', {
        turn: 1, step: 1, message: cloud, usage: { inputTokens: 200, outputTokens: 20 },
      }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 225_000,
      confirmedApiCostUsdNanos: 0,
      tokenEstimatedApiCostUsdNanos: 225_000,
      confirmedModelCalls: 0,
      estimatedModelCalls: 1,
      unaccountedModelCalls: 0,
      unaccountedModelAttempts: 1,
    })
  })

  it('preserves a confirmed partial charge when failover replacement usage is estimated', () => {
    const cloud = createMessage({
      role: 'assistant', content: [{ type: 'text', text: 'fallback' }],
      source: { kind: 'model', provider: 'google', model: 'gemini-3.6-flash' },
    })
    expect(foldPriced([
      at(100, 'request/header', { header: { config: { provider: 'omniroute', model: 'auto' } } }),
      at(110, 'step/start', { turn: 1, step: 1 }),
      at(120, 'assistant/chunk', {
        turn: 1, step: 1,
        chunk: {
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 10, providerCostUsdNanos: 42_000 },
        },
      }),
      at(130, 'llm/failover', {
        turn: 1, step: 1,
        from: { provider: 'omniroute', model: 'auto' },
        to: { provider: 'google', model: 'gemini-3.6-flash' },
      }),
      at(140, 'request/header', { header: { config: { provider: 'google', model: 'gemini-3.6-flash' } } }),
      at(150, 'assistant/message', {
        turn: 1, step: 1, message: cloud, usage: { inputTokens: 200, outputTokens: 20 },
      }),
    ])).toMatchObject({
      estimatedApiCostUsdNanos: 267_000,
      confirmedApiCostUsdNanos: 42_000,
      tokenEstimatedApiCostUsdNanos: 225_000,
      confirmedModelCalls: 1,
      estimatedModelCalls: 1,
      unaccountedModelCalls: 0,
      unaccountedModelAttempts: 0,
    })
  })

  it('rejects duplicate provider/model prices at the deployment boundary', () => {
    expect(() => createSessionStatsProjectionDefinition([...prices, prices[0]]))
      .toThrow('duplicate model price for google/gemini-3.6-flash')
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the definition and view the result. */
function fold(events: readonly SessionEvent[]): SessionStatsProjection {
  const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
    (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
    sessionStatsProjectionDefinition.init(),
  )
  return sessionStatsProjectionDefinition.wire.view(state)
}

describe('sessionStats wall-time fold (controlled timestamps)', () => {
  const message = createMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  })

  it('accrues model, first-token, and decode time from one fully recorded step', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_800, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      at(4_800, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 10, outputTokens: 60 } }),
      at(4_900, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, llmMs: 3_800, ttftMs: 800, ttftSteps: 1, decodeMs: 3_000, decodeTokens: 60,
      unpricedModelCalls: 1, unaccountedModelCalls: 1,
    }))
  })

  it('keeps the first attempt token boundary across an in-step retry (window resetForRetry parity)', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'x' } }),
      at(2_000, 'llm/retry', { turn: 1, step: 1 }),
      at(3_000, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'y' } }),
      at(5_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, llmMs: 4_000, ttftMs: 200, ttftSteps: 1,
      unpricedModelCalls: 1, unaccountedModelCalls: 1, unaccountedModelAttempts: 1,
    }))
  })

  it('ignores empty deltas, non-token chunks, and chunks outside the open step', () => {
    expect(fold([
      // Chunk before any step/start: no open boundary.
      at(500, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'stray' } }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      at(1_200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '' } }),
      at(1_300, 'assistant/chunk', { turn: 2, step: 9, chunk: { type: 'text-delta', index: 0, text: 'other' } }),
      at(1_400, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' } }),
      at(2_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1,
      unpricedModelCalls: 1, unaccountedModelCalls: 1,
    }))
  })

  it('leaves a cancelled step untimed: counted by step/end, no assembled message to accrue from', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs tool wall time by callId, ignores orphan results, and prunes leftovers at turn/end', () => {
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    const paired = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(1_200, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' }),
      // Out-of-order settlement pairs by id, not adjacency.
      at(4_200, 'tool/result', result('b')),
      at(1_600, 'tool/result', result('a')),
      at(5_000, 'tool/result', result('ghost')),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(paired).toEqual(totals({ turns: 1, steps: 1, toolMs: 3_500 }))
    // An unresolved call is dropped at turn/end; a later result cannot pair.
    const pruned = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'orphan', name: 'read', arguments: '{}' }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
      at(2_100, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(9_000, 'tool/result', result('orphan')),
    ])
    expect(pruned).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs only own pendingCalls keys: a prototype-name callId without a recorded call stays unmatched', () => {
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    // Crash recovery (TOOL_NOT_STARTED) emits results with no preceding
    // tool/call; a provider-minted callId colliding with an Object prototype
    // property must read as absent, not as an inherited function that would
    // fold toolMs to NaN and fail the value schema.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'tool/result', result('toString')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
    // The same name pairs normally once its call is recorded.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'constructor', name: 'read', arguments: '{}' }),
      at(1_600, 'tool/result', result('constructor')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, toolMs: 500 }))
  })

  it('skips decode for an invalid usage report and ignores a duplicate assembled message', () => {
    const events = [
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_400, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      // A malformed provider report: guarded like the window fold guards node usage.
      at(2_000, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 1, outputTokens: -5 } }),
    ]
    expect(fold([...events, at(2_100, 'step/end', { turn: 1, step: 1 })]))
      .toEqual(totals({
        turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1,
        unpricedModelCalls: 1, unaccountedModelCalls: 1,
      }))
    // The first message closed the step boundary; a defensive duplicate finds
    // no open step and folds to the same reference.
    const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
      (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
      sessionStatsProjectionDefinition.init(),
    )
    expect(sessionStatsProjectionDefinition.apply(
      state,
      at(2_050, 'assistant/message', { turn: 1, step: 1, message }),
    )).toBe(state)
  })

  it('accrues nothing for unrelated events and clamps negative clock skew to zero', () => {
    const state = sessionStatsProjectionDefinition.init()
    const untouched = sessionStatsProjectionDefinition.apply(state, at(1, 'user/message', { content: [] }))
    expect(untouched).toBe(state)
    expect(fold([
      at(2_000, 'step/start', { turn: 1, step: 1 }),
      at(1_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, unpricedModelCalls: 1, unaccountedModelCalls: 1,
    }))
  })
})
