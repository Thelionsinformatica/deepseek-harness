/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * chunks, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * The wall-time folds mirror the client window fold field by field
 * (`deriveStats` in dsh-client-ui-conversation, that fold's whole-window
 * fallback role): model time is `step/start` → `assistant/message`, first
 * token is the first non-empty delta chunk and survives an in-step
 * `llm/retry`, decode spans first token → assembled message on steps that
 * also report output tokens, and tool time pairs `tool/call` → `tool/result`
 * by callId. A cancelled step assembles no message, so its partial stream
 * time stays uncounted in every time figure — matching the window, which
 * renders it as an untimed interrupted node.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ModelTokenPrice } from './types.ts'

/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  /** Distinct turns with at least one closed step so far. */
  turns: number
  /** Closed steps so far. */
  steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
  /** Legacy accounted total: confirmed charges plus token estimates, in nanodollars. */
  estimatedApiCostUsdNanos: number
  /** Legacy count of calls carrying either a confirmed charge or token estimate. */
  pricedModelCalls: number
  /** Legacy alias for `unaccountedModelCalls`. */
  unpricedModelCalls: number
  /** Provider- or gateway-confirmed charge in nanodollars. */
  confirmedApiCostUsdNanos: number
  /** Estimate derived from usage and the configured token-price table, in nanodollars. */
  tokenEstimatedApiCostUsdNanos: number
  /** Calls whose usage carried a provider- or gateway-confirmed charge. */
  confirmedModelCalls: number
  /** Calls estimated from usage and an exact configured provider/model price. */
  estimatedModelCalls: number
  /** Completed calls lacking usage or an exact configured route price. */
  unaccountedModelCalls: number
  /** Failed request attempts lacking charge or token evidence. */
  unaccountedModelAttempts: number
}

/**
 * Fold state: the totals plus the in-flight boundaries they accrue from.
 * Turn numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** The open step's boundary facts; null outside a step or after its message assembled. */
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  pendingCalls: Record<string, number>
  /** Latest effective model route from the durable request header. */
  requestRoute: { provider: string; model: string } | null
  /** Last usage sample, replaced when the finalized message repeats its step's stream sample. */
  lastUsage: {
    turn: number
    step: number
    costUsdNanos: number
    accounting: 'confirmed' | 'estimated' | 'unaccounted'
  } | null
}

/** Projection definition whose client-visible statistics view is always present. */
type SessionStatsProjectionDefinition =
  Omit<ProjectionDefinition<'sessionStats', SessionStatsState>, 'wire'> & {
    wire: NonNullable<ProjectionDefinition<'sessionStats', SessionStatsState>['wire']>
  }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
  estimatedApiCostUsdNanos: z.number().int().nonnegative(),
  pricedModelCalls: z.number().int().nonnegative(),
  unpricedModelCalls: z.number().int().nonnegative(),
  confirmedApiCostUsdNanos: z.number().int().nonnegative(),
  tokenEstimatedApiCostUsdNanos: z.number().int().nonnegative(),
  confirmedModelCalls: z.number().int().nonnegative(),
  estimatedModelCalls: z.number().int().nonnegative(),
  unaccountedModelCalls: z.number().int().nonnegative(),
  unaccountedModelAttempts: z.number().int().nonnegative(),
}).strict()

/**
 * The fold state's shape (totals plus in-flight boundaries), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openStep: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
  }).nullable(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
  requestRoute: z.object({ provider: z.string(), model: z.string() }).nullable(),
  lastUsage: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    costUsdNanos: z.number().int().nonnegative(),
    accounting: z.enum(['confirmed', 'estimated', 'unaccounted']),
  }).nullable(),
})

/**
 * Provider-reported completion tokens, guarded the way the window fold guards
 * node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the output-token count, or null when unreported or invalid.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Stable table key for one exact provider route. */
function priceKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Validate uniqueness before a projection captures the deployment table. */
function pricingIndex(prices: readonly ModelTokenPrice[]): ReadonlyMap<string, ModelTokenPrice> {
  const index = new Map<string, ModelTokenPrice>()
  for (const price of prices) {
    const key = priceKey(price.provider, price.model)
    if (index.has(key)) throw new Error(`session-stats: duplicate model price for ${price.provider}/${price.model}`)
    index.set(key, price)
  }
  return index
}

/** Convert one provider usage report to an integer nanodollar estimate. */
function estimateUsageCost(usage: TokenUsage, price: ModelTokenPrice): number {
  const cacheReadPrice = price.cacheReadUsdPerMillion ?? price.inputUsdPerMillion
  const cacheWritePrice = price.cacheWriteUsdPerMillion ?? price.inputUsdPerMillion
  return Math.round(
    usage.inputTokens * price.inputUsdPerMillion * 1_000
    + usage.outputTokens * price.outputUsdPerMillion * 1_000
    + (usage.cacheReadTokens ?? 0) * cacheReadPrice * 1_000
    + (usage.cacheWriteTokens ?? 0) * cacheWritePrice * 1_000,
  )
}

/** A provider/gateway's exact durable charge, when valid. */
function reportedUsageCost(usage: TokenUsage): number | undefined {
  const value = usage.providerCostUsdNanos
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

type UsageAccounting = 'confirmed' | 'estimated' | 'unaccounted'

/** Replace the previous sample for one request attempt instead of counting stream and final usage twice. */
function applyUsageSample(
  state: SessionStatsState,
  turn: number,
  step: number,
  costUsdNanos: number,
  accounting: UsageAccounting,
): SessionStatsState {
  const nextSample = { turn, step, costUsdNanos, accounting }
  const previous = state.lastUsage?.turn === turn && state.lastUsage.step === step
    ? state.lastUsage
    : undefined
  if (previous !== undefined
    && previous.costUsdNanos === nextSample.costUsdNanos
    && previous.accounting === nextSample.accounting) return state
  const confirmedApiCostUsdNanos = state.confirmedApiCostUsdNanos
    - (previous?.accounting === 'confirmed' ? previous.costUsdNanos : 0)
    + (accounting === 'confirmed' ? costUsdNanos : 0)
  const tokenEstimatedApiCostUsdNanos = state.tokenEstimatedApiCostUsdNanos
    - (previous?.accounting === 'estimated' ? previous.costUsdNanos : 0)
    + (accounting === 'estimated' ? costUsdNanos : 0)
  const confirmedModelCalls = state.confirmedModelCalls
    - (previous?.accounting === 'confirmed' ? 1 : 0) + (accounting === 'confirmed' ? 1 : 0)
  const estimatedModelCalls = state.estimatedModelCalls
    - (previous?.accounting === 'estimated' ? 1 : 0) + (accounting === 'estimated' ? 1 : 0)
  const unaccountedModelCalls = state.unaccountedModelCalls
    - (previous?.accounting === 'unaccounted' ? 1 : 0) + (accounting === 'unaccounted' ? 1 : 0)
  return {
    ...state,
    estimatedApiCostUsdNanos: confirmedApiCostUsdNanos + tokenEstimatedApiCostUsdNanos,
    pricedModelCalls: confirmedModelCalls + estimatedModelCalls,
    unpricedModelCalls: unaccountedModelCalls,
    confirmedApiCostUsdNanos,
    tokenEstimatedApiCostUsdNanos,
    confirmedModelCalls,
    estimatedModelCalls,
    unaccountedModelCalls,
    lastUsage: nextSample,
  }
}

/** Classify one usage sample by the strongest cost evidence it carries. */
function applyUsage(
  state: SessionStatsState,
  turn: number,
  step: number,
  usage: TokenUsage,
  route: { provider: string; model: string } | null,
  prices: ReadonlyMap<string, ModelTokenPrice>,
): SessionStatsState {
  const reportedCost = reportedUsageCost(usage)
  if (reportedCost !== undefined) {
    return applyUsageSample(state, turn, step, reportedCost, 'confirmed')
  }
  const price = route === null ? undefined : prices.get(priceKey(route.provider, route.model))
  if (price !== undefined) {
    return applyUsageSample(state, turn, step, estimateUsageCost(usage, price), 'estimated')
  }
  return applyUsageSample(state, turn, step, 0, 'unaccounted')
}

/** Close one failed attempt before a retry/failover starts the next attempt in the same step. */
function applyUnaccountedAttempt(
  state: SessionStatsState,
  event: { data: { turn: number; step: number } },
): SessionStatsState {
  const previous = state.lastUsage?.turn === event.data.turn && state.lastUsage.step === event.data.step
    ? state.lastUsage
    : undefined
  return previous === undefined
    ? { ...state, unaccountedModelAttempts: state.unaccountedModelAttempts + 1 }
    : { ...state, lastUsage: null }
}

/**
 * Build the `sessionStats` unit with one immutable deployment pricing table.
 * @param prices - Exact provider/model token prices owned by this deployment.
 * @returns The durable session statistics projection definition.
 */
export function createSessionStatsProjectionDefinition(
  prices: readonly ModelTokenPrice[] = [],
): SessionStatsProjectionDefinition {
  const priceByRoute = pricingIndex(prices)
  const definition = {
    key: 'sessionStats',
    stateVersion: 3,
    stateSchema: sessionStatsStateSchema,
    init: () => ({
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
      estimatedApiCostUsdNanos: 0,
      pricedModelCalls: 0,
      unpricedModelCalls: 0,
      confirmedApiCostUsdNanos: 0,
      tokenEstimatedApiCostUsdNanos: 0,
      confirmedModelCalls: 0,
      estimatedModelCalls: 0,
      unaccountedModelCalls: 0,
      unaccountedModelAttempts: 0,
      lastTurn: null,
      openStep: null,
      pendingCalls: {},
      requestRoute: null,
      lastUsage: null,
    }),
    apply: (state, event) => {
      // Every uninteresting event returns the same reference (Object.is gates the change feed).
      const eventType: string = event.type
      if (eventType === 'llm/retry' || eventType === 'llm/failover') {
        return applyUnaccountedAttempt(
          state,
          event as unknown as { data: { turn: number; step: number } },
        )
      }
      switch (event.type) {
        case 'request/header':
          return {
            ...state,
            requestRoute: {
              provider: event.data.header.config.provider,
              model: event.data.header.config.model,
            },
          }
        case 'step/start':
          return {
            ...state,
            openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null },
          }
        case 'assistant/chunk': {
          const open = state.openStep
          if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
          if (event.data.chunk.type === 'usage') {
            return applyUsage(
              state, event.data.turn, event.data.step, event.data.chunk.usage, state.requestRoute, priceByRoute,
            )
          }
          if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) return state
          return { ...state, openStep: { ...open, firstTokenTime: event.time } }
        }
        case 'assistant/message': {
          const open = state.openStep
          if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
          // One assembled message per step: closing the boundary means a
          // defensive duplicate cannot accrue twice.
          let next: SessionStatsState = {
            ...state,
            llmMs: state.llmMs + Math.max(0, event.time - open.startTime),
            openStep: null,
          }
          if (open.firstTokenTime !== null) {
            next.ttftMs += Math.max(0, open.firstTokenTime - open.startTime)
            next.ttftSteps += 1
            const outputTokens = usageOutputTokens(event.data.usage)
            if (outputTokens !== null) {
              next.decodeMs += Math.max(0, event.time - open.firstTokenTime)
              next.decodeTokens += outputTokens
            }
          }
          if (event.data.usage !== undefined) {
            const source = event.data.message.source
            const route = { provider: source.provider, model: source.model }
            next = applyUsage(next, event.data.turn, event.data.step, event.data.usage, route, priceByRoute)
          } else if (next.lastUsage?.turn !== event.data.turn || next.lastUsage.step !== event.data.step) {
            next = applyUsageSample(next, event.data.turn, event.data.step, 0, 'unaccounted')
          }
          return next
        }
        case 'tool/call':
          return { ...state, pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.time } }
        case 'tool/result': {
          // Own-key check: callId is provider-minted (model/tool JSON boundary),
          // so a prototype property name ('constructor', 'toString') on a result
          // with no recorded call must read as unmatched, not as an inherited
          // function that would poison toolMs with NaN.
          const callId = event.data.message.source.callId
          const dispatched = Object.hasOwn(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
          if (dispatched === undefined) return state
          const pendingCalls = Object.fromEntries(
            Object.entries(state.pendingCalls).filter(([id]) => id !== callId),
          )
          return { ...state, toolMs: state.toolMs + Math.max(0, event.time - dispatched), pendingCalls }
        }
        case 'step/end':
          return {
            ...state,
            turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
            steps: state.steps + 1,
            lastTurn: event.data.turn,
            openStep: null,
          }
        case 'turn/end':
          // A call whose result never landed belongs to a cancelled or failed
          // turn; results always land within their turn, so drop the leftovers
          // instead of growing persisted state forever.
          return Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }
        default:
          return state
      }
    },
    wire: {
      viewSchema: sessionStatsSchema,
      view: state => ({
        turns: state.turns,
        steps: state.steps,
        llmMs: state.llmMs,
        toolMs: state.toolMs,
        ttftMs: state.ttftMs,
        ttftSteps: state.ttftSteps,
        decodeMs: state.decodeMs,
        decodeTokens: state.decodeTokens,
        estimatedApiCostUsdNanos: state.estimatedApiCostUsdNanos,
        pricedModelCalls: state.pricedModelCalls,
        unpricedModelCalls: state.unpricedModelCalls,
        confirmedApiCostUsdNanos: state.confirmedApiCostUsdNanos,
        tokenEstimatedApiCostUsdNanos: state.tokenEstimatedApiCostUsdNanos,
        confirmedModelCalls: state.confirmedModelCalls,
        estimatedModelCalls: state.estimatedModelCalls,
        unaccountedModelCalls: state.unaccountedModelCalls,
        unaccountedModelAttempts: state.unaccountedModelAttempts,
      }),
    },
  } satisfies ProjectionDefinition<'sessionStats', SessionStatsState>
  return definition
}

/** Config-free definition retained for direct folds and assemblies without API pricing. */
export const sessionStatsProjectionDefinition = createSessionStatsProjectionDefinition()
