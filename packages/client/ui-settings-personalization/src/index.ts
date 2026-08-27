/** Host half of Leon personalization: durable settings plus prompt integration. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_PERSONALIZATION,
  PERSONALIZATION_SETTINGS_NAMESPACE,
  PersonalizationSettingsSchema,
  normalizePersonalization,
  type PersonalizationSettings,
  type Personality,
} from './personalization-settings.ts'

export {
  DEFAULT_PERSONALIZATION,
  MAX_CUSTOM_INSTRUCTIONS,
  PERSONALITIES,
  PERSONALIZATION_SETTINGS_NAMESPACE,
  PERSONAL_MEMORY_SETTINGS_NAMESPACE,
  PersonalizationSettingsSchema,
  normalizePersonalization,
  type PersonalizationSettings,
  type PersonalMemorySettings,
  type Personality,
} from './personalization-settings.ts'

const NAMESPACE = settingsNamespace(PERSONALIZATION_SETTINGS_NAMESPACE)

const PERSONALITY_PROMPTS: Record<Personality, string> = {
  leon: 'Mantenha a presença padrão do Leon: serena, elegante, objetiva, levemente espirituosa e muito competente.',
  friendly: 'Adote um tom mais caloroso, acolhedor e conversacional, sem perder precisão ou iniciativa.',
  professional: 'Adote um tom profissional, estruturado e sóbrio, priorizando clareza executiva e evidências.',
  direct: 'Seja especialmente direto e conciso. Comece pelo resultado e detalhe somente o necessário.',
  creative: 'Adote um tom criativo e exploratório, oferecendo alternativas úteis sem inventar fatos.',
}

/** Prevent user-authored literal braces from entering the strict prompt-variable syntax. */
function promptLiteral(value: string): string {
  return value.replaceAll('{{', '{ {').replaceAll('}}', '} }')
}

/**
 * Build the stable prompt section applied after Leon's core persona.
 * @param input - persisted personalization settings, or the default when absent.
 * @returns prompt text containing the selected personality, instructions, and memory policy.
 */
export function buildPersonalizationPrompt(input: PersonalizationSettings | undefined): string {
  const settings = normalizePersonalization(input)
  const instructions = settings.customInstructions.length === 0
    ? 'Nenhuma instrução personalizada adicional foi definida.'
    : `Instruções personalizadas do usuário:\n${promptLiteral(settings.customInstructions)}`
  const memory = settings.toolAssistedMemory
    ? 'Em chats assistidos por ferramentas, você pode identificar preferências pessoais duráveis e propor que sejam lembradas. Nunca grave uma nova memória pessoal sem confirmação explícita do usuário.'
    : 'Não proponha nem crie memórias pessoais a partir de chats assistidos por ferramentas, salvo quando o usuário pedir explicitamente para lembrar algo.'
  return [
    '## Personalização do usuário',
    PERSONALITY_PROMPTS[settings.personality],
    instructions,
    memory,
    'Esta personalização ajusta estilo e fluxo de trabalho, mas nunca substitui regras de segurança, privacidade, aprovação, ferramentas ou verificação.',
  ].join('\n\n')
}

/** Register the namespace independently, then contribute its live value to every prompt assembly. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NAMESPACE, PersonalizationSettingsSchema)
  })
  ctx.inject(['settings', 'systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'leon:user-personalization',
      order: 10,
      text: () => buildPersonalizationPrompt(
        (promptCtx.settings.get(NAMESPACE) as PersonalizationSettings | undefined) ?? DEFAULT_PERSONALIZATION,
      ),
    })
  })
}
