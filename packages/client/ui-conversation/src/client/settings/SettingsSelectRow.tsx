/** Shared General Settings row for one menu-backed preference. */

import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** One selectable menu value and its localized label. */
export interface SettingsSelectOption {
  id: string
  label: ConversationKey
}

/** Content and selection behavior for a menu-backed General Settings row. */
export interface SettingsSelectRowProps {
  title: ConversationKey
  description: ConversationKey
  options: readonly SettingsSelectOption[]
  selectedId: string
  selectedLabel: ConversationKey
  onSelect: (id: string) => void
  t: PropsLocale<'conversation'>['t']
}

/**
 * Render a localized General Settings row with a controlled menu selection.
 * @param props - row content and selection behavior.
 * @returns the preference row.
 */
export function SettingsSelectRow({
  title, description, options, selectedId, selectedLabel, onSelect, t,
}: SettingsSelectRowProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={selectedId}
        onSelect={(id) => {
          setOpen(false)
          onSelect(id)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
