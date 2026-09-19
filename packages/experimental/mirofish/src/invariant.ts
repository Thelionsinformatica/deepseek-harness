/** Package-owned invariant companion for the MiroFish bridge. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-mirofish'

/** Cordis companion plugin name. */
export const name = 'experimental-mirofish-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: the bridge owns no durable or event relationships; approval and tool output stay with their owning services. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
