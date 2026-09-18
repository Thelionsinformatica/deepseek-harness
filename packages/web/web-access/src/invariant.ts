/** Package-owned invariant for explicit web-access session events. */

import type { Context } from '@deepseek-ai/cordis'
import { installSessionEventValidation } from '@deepseek-ai/dsh-session/invariant'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-access'

/** Cordis companion plugin name. */
export const name = 'web-access-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Reject malformed durable access decisions before they become projection state. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) =>
  installSessionEventValidation(ctx, (event) => {
    if (event.type !== 'web/access') return
    if (typeof event.data.enabled !== 'boolean') {
      fail(`web/access carries invalid enabled state ${JSON.stringify(event.data.enabled)}; expected a boolean`)
    }
  })

/** Register the invariant under this package's durable ownership key. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
