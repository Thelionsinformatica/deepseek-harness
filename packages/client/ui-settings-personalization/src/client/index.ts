/** Browser half of Leon's Personalization settings feature. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { remoteValue } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-tool-memory/remote'
import type { PersonalMemoryAdminListValue } from '@deepseek-ai/dsh-tool-memory/types'
import {
  PERSONALIZATION_SETTINGS_NAMESPACE,
  PERSONAL_MEMORY_SETTINGS_NAMESPACE,
  type PersonalizationSettings,
  type PersonalMemorySettings,
  type Personality,
} from '../personalization-settings.ts'
import {
  PersonalizationSection,
  type PersonalizationSectionInjected,
} from './PersonalizationSection.tsx'
import { en, pt, zh, type PersonalizationKey } from './locales.ts'

export { PersonalizationSection } from './PersonalizationSection.tsx'
export type { PersonalizationSectionInjected, PersonalizationSectionProps } from './PersonalizationSection.tsx'
export type { PersonalizationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.personalization': PersonalizationKey
  }
}

/** Locale namespace used by the personalization settings surface. */
export const SETTINGS_NS = 'settings.personalization'

/** Permanently clear the owner-isolated personal-memory partition in audited batches. */
async function clearAllPersonalMemories(ctx: ClientContext, sessionId: SessionId): Promise<number> {
  let removed = 0
  for (let batch = 0; batch < 100; batch += 1) {
    const carried = await ctx.remote.memoryCandidateReview.listPersonalMemories({
      sessionId,
      statuses: ['active', 'scheduled', 'expired', 'superseded'],
      offset: 0,
      limit: 100,
    })
    const page = remoteValue<PersonalMemoryAdminListValue>(carried)
    if (page.items.length === 0) return removed
    for (const item of page.items) {
      const forgotten = await ctx.remote.memoryCandidateReview.forgetPersonalMemory({
        sessionId,
        id: item.id,
        revision: item.revision,
        confirmed: true,
      })
      remoteValue(forgotten)
      removed += 1
    }
  }
  throw new Error('personal-memory clear exceeded the bounded batch count')
}

export const inject = [
  'slots', 'locale', 'settingsScope', 'sessions', 'remote', 'remote.memoryCandidateReview',
]

/** Register the section and bind its controls to Host settings and audited memory operations. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { pt, zh, en }), 'ui-settings-personalization: dictionaries')

  const personalization = ctx.settingsScope.bind<PersonalizationSettings>({
    namespace: PERSONALIZATION_SETTINGS_NAMESPACE,
  })
  const personalMemory = ctx.settingsScope.bind<PersonalMemorySettings>({
    namespace: PERSONAL_MEMORY_SETTINGS_NAMESPACE,
  })
  const t = ctx.locale.bind(SETTINGS_NS) as PersonalizationSectionInjected['t']
  const injected = (): PersonalizationSectionInjected => ({
    hooks: {
      personalization,
      personalMemory,
      sessions: ctx.sessions.list,
    },
    saveInstructions: instructions => personalization.set('customInstructions', instructions),
    setPersonality: (personality: Personality) => personalization.set('personality', personality),
    setToolAssistedMemory: enabled => personalization.set('toolAssistedMemory', enabled),
    setPersonalMemoryEnabled: enabled => personalMemory.set('enabled', enabled),
    clearPersonalMemories: sessionId => clearAllPersonalMemories(ctx, sessionId),
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personalization',
    order: 5,
    label: () => t('nav'),
    inject: injected,
  }, PersonalizationSection))
}
