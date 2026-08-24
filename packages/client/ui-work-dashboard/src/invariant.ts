/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-work-dashboard`.
 * @module @deepseek-ai/dsh-client-ui-work-dashboard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-work-dashboard'

/** Cordis companion plugin name. */
export const name = 'client-ui-work-dashboard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the dashboard is a pure projection of framework
 * Session and Workspace hooks, and its callbacks delegate to their owning
 * services without emitting events or retaining mutable cross-plugin state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
