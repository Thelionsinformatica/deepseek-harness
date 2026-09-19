/** Durable end-user personalization owned by Leon's settings feature. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace persisted in the Host user-settings document. */
export const PERSONALIZATION_SETTINGS_NAMESPACE = 'leon-personalization'

/** Response styles offered by the product selector. */
export const PERSONALITIES = ['leon', 'friendly', 'professional', 'direct', 'creative'] as const

/** One response-style id. */
export type Personality = typeof PERSONALITIES[number]

/** Persisted personalization fields. */
export interface PersonalizationSettings {
  /** Extra user-authored operating instructions appended after Leon's identity. */
  readonly customInstructions: string
  /** Stable response-style profile. */
  readonly personality: Personality
  /** Whether tool-assisted chats may produce personal-memory suggestions. */
  readonly toolAssistedMemory: boolean
}

/** Defaults preserve Leon's existing identity while enabling reviewed memory suggestions. */
export const DEFAULT_PERSONALIZATION: PersonalizationSettings = Object.freeze({
  customInstructions: '',
  personality: 'leon',
  toolAssistedMemory: true,
})

/** Host schema and browser wire envelope. */
export const PersonalizationSettingsSchema: z<PersonalizationSettings> = z.object({
  customInstructions: z.string().default(DEFAULT_PERSONALIZATION.customInstructions),
  personality: z.union([...PERSONALITIES]).default(DEFAULT_PERSONALIZATION.personality),
  toolAssistedMemory: z.boolean().default(DEFAULT_PERSONALIZATION.toolAssistedMemory),
})

/** Personal-memory namespace already owned by tool-memory's review service. */
export const PERSONAL_MEMORY_SETTINGS_NAMESPACE = 'personal-memory'

/** Browser-visible subset of the existing personal-memory preference. */
export interface PersonalMemorySettings {
  readonly enabled: boolean
}

/** Maximum custom-instruction length accepted by the product surface. */
export const MAX_CUSTOM_INSTRUCTIONS = 12_000

/**
 * Narrow a wire value before placing it in a prompt.
 * @param value - persisted personalization value, or undefined when no value exists.
 * @returns normalized, length-bounded personalization settings.
 */
export function normalizePersonalization(value: PersonalizationSettings | undefined): PersonalizationSettings {
  if (value === undefined) return DEFAULT_PERSONALIZATION
  const customInstructions = value.customInstructions.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS)
  const personality = PERSONALITIES.includes(value.personality) ? value.personality : DEFAULT_PERSONALIZATION.personality
  return { customInstructions, personality, toolAssistedMemory: value.toolAssistedMemory }
}
