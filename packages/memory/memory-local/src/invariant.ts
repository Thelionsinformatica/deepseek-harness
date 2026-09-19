/** Package-owned invariant companion for `@deepseek-ai/dsh-memory-local`. @module @deepseek-ai/dsh-memory-local/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-local'

export const name = 'memory-local-invariant'
export const inject = ['invariants']

/** No runtime invariant: the storage-domain schema validates every durable record at the provider boundary. */
const install: InvariantInstaller = () => {}

/** Register the package companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
