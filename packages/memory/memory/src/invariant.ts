/** Package-owned invariant companion for `@deepseek-ai/dsh-memory`. @module @deepseek-ai/dsh-memory/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory'

export const name = 'memory-invariant'
export const inject = ['invariants']

/** No runtime invariant: provider maps are private and every operation re-runs selection and validation. */
const install: InvariantInstaller = () => {}

/** Register the package companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
