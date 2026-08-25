/** Package invariant companion for `@deepseek-ai/dsh-personal-memory-local`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-personal-memory-local'
export const name = 'personal-memory-local-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: storage-domain checks and provider tests cover this adapter's runtime contract.
}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
