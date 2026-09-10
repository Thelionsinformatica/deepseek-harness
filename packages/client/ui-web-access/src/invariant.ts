/** Package-owned invariant companion for dsh-client-ui-web-access. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-web-access'

/** Cordis companion plugin name. */
export const name = 'client-ui-web-access-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Slot declaration, registration, and teardown are covered by this package's browser test. */
const install: InvariantInstaller = () => {}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
