/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-knowledge-base`.
 * @module @deepseek-ai/dsh-tool-knowledge-base/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-knowledge-base'

/** Cordis companion plugin name. */
export const name = 'tool-knowledge-base-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: execution and cancellation are owned by the subprocess
 * seam, while each helper result is validated synchronously before exposure.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
