/** Package invariant companion for `@deepseek-ai/dsh-personal-memory`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-personal-memory'
export const name = 'personal-memory-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: the service validates ownership, providers, and requests at its public boundary.
}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
