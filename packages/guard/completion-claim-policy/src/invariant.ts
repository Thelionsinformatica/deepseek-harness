/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-completion-claim-policy`.
 * @module @deepseek-ai/dsh-completion-claim-policy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-completion-claim-policy'

/** Cordis companion plugin name. */
export const name = 'completion-claim-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the policy reconstructs evidence from the immutable
 * current-turn event tail before each stop and keeps no independent state.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
