/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-skill`.
 * @module @deepseek-ai/dsh-client-ui-skill/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-skill'

/** Cordis companion plugin name. */
export const name = 'client-ui-skill-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: slash, locale, toolview, and Settings registrations
 * are registry-owned; their disposal is proven by the HMR-safety spec.
 * Settings state is a disposable Host projection, not an authoritative fact
 * source. Controller tests cover stale reads, revision-fenced writes, and
 * disposal. This package emits no cordis events or cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
