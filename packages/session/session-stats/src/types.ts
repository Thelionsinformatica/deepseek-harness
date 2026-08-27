/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
  /** Legacy accounted total (confirmed provider charges plus token estimates), in nanodollars. */
  estimatedApiCostUsdNanos: number
  /** Legacy count of calls with either a confirmed charge or a configured token estimate. */
  pricedModelCalls: number
  /** Legacy alias for {@link unaccountedModelCalls}. */
  unpricedModelCalls: number
  /** Provider- or gateway-confirmed charge in integer billionths of one US dollar. */
  confirmedApiCostUsdNanos?: number
  /** Token-price estimate in integer billionths of one US dollar. */
  tokenEstimatedApiCostUsdNanos?: number
  /** Calls whose provider or gateway supplied a confirmed charge, including an explicit zero. */
  confirmedModelCalls?: number
  /** Calls estimated from token usage and an exact configured provider/model price. */
  estimatedModelCalls?: number
  /** Completed calls that cannot be priced because usage or an exact route price is unavailable. */
  unaccountedModelCalls?: number
  /** Failed request attempts observed through durable retry/failover records without cost evidence. */
  unaccountedModelAttempts?: number
}

/** One exact provider/model price used for durable cost estimation. */
export interface ModelTokenPrice {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Standard input price in USD per one million uncached tokens. */
  inputUsdPerMillion: number
  /** Standard output price in USD per one million tokens. */
  outputUsdPerMillion: number
  /** Cached-input price; omission uses the ordinary input price. */
  cacheReadUsdPerMillion?: number
  /** Cache-write price; omission uses the ordinary input price. */
  cacheWriteUsdPerMillion?: number
}

/** Deployment-owned model pricing table. An absent table disables cost accounting. */
export interface SessionStatsConfig {
  /** Exact provider/model token prices used to estimate the API cost of durable usage events. */
  prices?: ModelTokenPrice[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
