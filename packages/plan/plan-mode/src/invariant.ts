/** Package-owned durable plan-mode invariants. @module @deepseek-ai/dsh-plan-mode/invariant */

import type { Context } from '@deepseek-ai/cordis'
import { installSessionEventValidation } from '@deepseek-ai/dsh-session/invariant'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plan-mode'

/** Cordis companion plugin name. */
export const name = 'plan-mode-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one `plan/mode` event before it reaches the durable log.
 * `plan/mode` is a standalone whole-value event: an idle selection commits
 * between turns and a mid-turn selection commits at the step boundary, so
 * no turn-enclosure relation exists — only the payload shape is checkable.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) =>
  installSessionEventValidation(ctx, (event) => {
    if (event.type !== 'plan/mode') return
    const active = (event.data as { active?: unknown }).active
    if (typeof active !== 'boolean') {
      fail(`plan/mode carries invalid active state ${JSON.stringify(active)}; expected a boolean`)
    }
  })

/**
 * Register the plan-mode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
