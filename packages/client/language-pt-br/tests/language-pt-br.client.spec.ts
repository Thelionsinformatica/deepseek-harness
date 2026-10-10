// @vitest-environment jsdom
/**
 * The pt-BR pack over the real locale runtime: it adds a selectable language
 * that falls back to English, translates registered namespaces, keeps every
 * {placeholder} its English source carries, and unregisters on dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as pack from '@deepseek-ai/dsh-client-language-pt-br/client'
import { dictionaries } from '../src/client/dictionaries.ts'

afterEach(() => { vi.unstubAllGlobals() })

async function mount(languages: string[]) {
  vi.stubGlobal('navigator', { languages, language: languages[0] ?? '' })
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  locale.register('common', 'en', { cancel: 'Cancel', onlyEnglish: 'English only' })
  locale.register('common', 'zh', { cancel: '取消', onlyEnglish: '仅英文' })
  const fiber = ctx.plugin(pack)
  await fiber.await()
  return { ctx, locale, fiber }
}

describe('language-pt-br', () => {
  it('adds pt-BR with an English fallback and translates registered namespaces', async () => {
    const { locale } = await mount(['en-US'])
    locale.setLocale('pt-BR')
    const t = locale.bind('common')
    expect(t('cancel')).toBe('Cancelar')
    // A key the pack does not translate reaches the English fallback, never the raw key.
    expect(t('onlyEnglish')).toBe('English only')
  })

  it('is selected automatically for a Portuguese browser', async () => {
    const { locale } = await mount(['pt-BR', 'en'])
    expect(locale.getLocale().active).toBe('pt-BR')
  })

  it('removes the language and its dictionaries on dispose', async () => {
    const { locale, fiber } = await mount(['en-US'])
    await fiber.dispose()
    expect(() => locale.register('common', 'pt-BR', {})).not.toThrow()
  })

  it('ships string values with well-formed placeholders', () => {
    for (const [namespace, dictionary] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(typeof value, `${namespace}.${key}`).toBe('string')
        expect(value.replaceAll(/\{\w+\}/g, ''), `${namespace}.${key}`).not.toMatch(/[{}]/)
      }
    }
    expect(Object.keys(dictionaries).length).toBeGreaterThan(50)
  })
})
