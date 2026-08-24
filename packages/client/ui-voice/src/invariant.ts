/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-voice`.
 * @module @deepseek-ai/dsh-client-ui-voice/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-voice'

/** Cordis companion plugin name. */
export const name = 'client-ui-voice-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser owns the ephemeral MediaStream and the
 * controller releases it whenever the slot lifetime ends. No Session event is
 * authored until a future transcriber produces ordinary draft text.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
