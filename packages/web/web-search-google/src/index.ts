/**
 * Register a Gemini Google Search grounding provider in `ctx.web`. The provider reuses Leon's
 * `GOOGLE_API_KEY` credential reference and issues stateless Interactions API requests.
 * @module @deepseek-ai/dsh-web-search-google
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  GOOGLE_SEARCH_DEFAULT_BASE_URL,
  GOOGLE_SEARCH_DEFAULT_MODEL,
  GoogleSearchProvider,
} from './provider.ts'
import type { GoogleSearchProviderOptions } from './provider.ts'

export {
  GOOGLE_SEARCH_DEFAULT_BASE_URL,
  GOOGLE_SEARCH_DEFAULT_MODEL,
  GOOGLE_SEARCH_PROVIDER_ID,
  GoogleSearchProvider,
  mapGoogleInteraction,
} from './provider.ts'
export type { GoogleSearchLlmRequest, GoogleSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-google'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'GOOGLE_API_KEY'

/** Plugin configuration projected for each search operation. */
export interface Config {
  /** Literal Google API key; prefer {@link apiKeyEnv}. */
  apiKey?: string
  /** Credential reference resolved for each search. */
  apiKeyEnv?: string
  /** Gemini API base; `/interactions` is appended. */
  baseURL?: string
  /** Search-capable Gemini model id. */
  model?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(GOOGLE_SEARCH_DEFAULT_BASE_URL),
  model: z.string().default(GOOGLE_SEARCH_DEFAULT_MODEL),
})

/** Settings namespace carrying this provider's endpoint, model, and credential reference. */
export const WEB_SEARCH_GOOGLE_SETTINGS_NAMESPACE = settingsNamespace('web-search-google')

/** Resolve the current settings section into one operation's provider options. */
/* jscpd:ignore-start -- provider plugins deliberately mirror the same credential/settings
 * lifecycle while retaining dialect-specific defaults, request events, and package ownership. */
function resolveOptions(ctx: Context, config: Config): GoogleSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? GOOGLE_SEARCH_DEFAULT_BASE_URL,
    model: config.model ?? GOOGLE_SEARCH_DEFAULT_MODEL,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/google-search-llm-request',
        request,
      )
    },
  }
}
/* jscpd:ignore-end */

/** Register the Google Search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_GOOGLE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new GoogleSearchProvider(() => resolveOptions(ctx, current())))
}
