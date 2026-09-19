/** Package-owned invariant companion for Leon personalization. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-personalization'

export const name = 'client-ui-settings-personalization-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the settings seam validates durable personalization
 * values and the prompt contribution is a pure projection of that value;
 * package tests cover the Host projection and browser-side editing flow.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
