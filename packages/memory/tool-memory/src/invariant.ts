/** Package-owned invariant companion for `@deepseek-ai/dsh-tool-memory`. @module @deepseek-ai/dsh-tool-memory/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-memory'

export const name = 'tool-memory-invariant'
export const inject = ['invariants']

/** No runtime invariant: tool outputs are validated by their canonical JSON schemas before logging. */
const install: InvariantInstaller = () => {}

/** Register the package companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
