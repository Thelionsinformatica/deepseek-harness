/**
 * Brazilian Portuguese language pack. Adds `pt-BR` to the language catalog
 * with English as its fallback and registers a pt-BR dictionary for every
 * namespace it translates; a browser whose preferred language is Portuguese
 * selects it automatically, and the Language row offers it explicitly.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { dictionaries } from './dictionaries.ts'

/** Locale id persisted by the Language preference. */
export const LOCALE_ID = 'pt-BR'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'language-pt-br'

/** The locale service this pack extends. */
export const inject = ['locale']

/** Register the language and its dictionaries for the plugin's lifetime. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.addLanguage({ id: LOCALE_ID, label: 'Português (Brasil)', fallback: 'en' }), 'language-pt-br: language')
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(namespace, LOCALE_ID, dictionary), `language-pt-br: ${namespace}`)
  }
}
