import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  PERSONALIZATION_SETTINGS_NAMESPACE,
  apply,
  buildPersonalizationPrompt,
} from '@deepseek-ai/dsh-client-ui-settings-personalization'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('Leon personalization host', () => {
  it('registers durable settings and applies their current value to every prompt assembly', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: 'PERSONA LEON' }).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(PERSONALIZATION_SETTINGS_NAMESPACE)

    expect(ctx.settings.get(ns)).toMatchObject({
      customInstructions: '', personality: 'leon', toolAssistedMemory: true,
    })
    await ctx.settings.update(ns, {
      customInstructions: 'Priorize {{literal}} e valide a entrega.',
      personality: 'friendly',
      toolAssistedMemory: false,
    })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('PERSONA LEON')
    expect(prompt).toContain('tom mais caloroso')
    expect(prompt).toContain('Priorize { {literal} } e valide a entrega.')
    expect(prompt).toContain('Não proponha nem crie memórias pessoais')
    expect(prompt.indexOf('PERSONA LEON')).toBeLessThan(prompt.indexOf('## Personalização do usuário'))

    await expect(ctx.settings.update(ns, { personality: 'unsupported' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('keeps core safety and explicit memory confirmation in every style', () => {
    const prompt = buildPersonalizationPrompt({
      customInstructions: 'Seja informal.',
      personality: 'creative',
      toolAssistedMemory: true,
    })
    expect(prompt).toContain('Nunca grave uma nova memória pessoal sem confirmação explícita')
    expect(prompt).toContain('nunca substitui regras de segurança, privacidade, aprovação, ferramentas ou verificação')
  })
})
