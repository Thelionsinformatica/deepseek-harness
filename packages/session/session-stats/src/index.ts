/**
 * Function plugin registering the `sessionStats` projection unit: whole-log
 * turn/step counts and LLM/tool/first-token/decode wall times served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the fold; delivery is the
 * seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createSessionStatsProjectionDefinition } from './projection.ts'
import type { SessionStatsConfig } from './types.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** Deployment-owned token prices; omission keeps cost estimation disabled. */
export type Config = SessionStatsConfig
const modelPrice = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  inputUsdPerMillion: z.number().min(0).required(),
  outputUsdPerMillion: z.number().min(0).required(),
  cacheReadUsdPerMillion: z.number().min(0),
  cacheWriteUsdPerMillion: z.number().min(0),
})
/** Loader validation for the optional exact-route price table. */
export const Config: z<Config> = z.object({ prices: z.array(modelPrice).default([]) })

/**
 * Register the `sessionStats` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.sessionProjections.register(createSessionStatsProjectionDefinition(config.prices))
}
