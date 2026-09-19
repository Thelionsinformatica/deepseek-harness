/** Package-owned invariant companion for `@deepseek-ai/dsh-memory-continuity`. @module @deepseek-ai/dsh-memory-continuity/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-continuity'

export const name = 'memory-continuity-invariant'
export const inject = ['invariants']

/** No runtime invariant: callers own snapshot storage and journals; the provider retains no authoritative event or mutable state. */
const install: InvariantInstaller = () => {}

/** Register the package companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
