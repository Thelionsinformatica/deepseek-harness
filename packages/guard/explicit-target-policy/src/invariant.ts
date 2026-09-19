/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-explicit-target-policy`.
 * @module @deepseek-ai/dsh-explicit-target-policy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-explicit-target-policy'

/** Cordis companion plugin name. */
export const name = 'explicit-target-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: target provenance and containment are enforced synchronously by the
 * monotonic tool guard, while per-agent locks are scoped to the owning plugin fiber.
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
