/** General Settings row controlling diagnostic context rows in the transcript. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationKey } from '../locales.ts'
import { SettingsSelectRow } from './SettingsSelectRow.tsx'

/** Registration-side visibility preference face. */
export interface TechnicalContextRowInjected {
  hooks: {
    /** Persisted preference bound by the renderer as useTechnicalContextVisible. */
    technicalContextVisible: SnapshotStore<boolean>
  }
  /** Show or hide prompt-assembly events in the transcript. */
  setTechnicalContextVisible: (visible: boolean) => void
}

export type TechnicalContextRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<TechnicalContextRowInjected>

const OPTIONS: readonly { id: 'hidden' | 'shown'; label: ConversationKey }[] = [
  { id: 'hidden', label: 'settings.technicalContext.hidden' },
  { id: 'shown', label: 'settings.technicalContext.shown' },
]

/** Render the visibility selector without changing the durable session log. */
export function TechnicalContextRow({
  useTechnicalContextVisible, setTechnicalContextVisible, t,
}: TechnicalContextRowProps) {
  const visible = useTechnicalContextVisible(value => value)
  const selected = visible ? 'shown' : 'hidden'

  return (
    <SettingsSelectRow
      title="settings.technicalContext.title"
      description="settings.technicalContext.description"
      options={OPTIONS}
      selectedId={selected}
      selectedLabel={visible ? 'settings.technicalContext.shown' : 'settings.technicalContext.hidden'}
      onSelect={(id) => { setTechnicalContextVisible(id === 'shown') }}
      t={t}
    />
  )
}
