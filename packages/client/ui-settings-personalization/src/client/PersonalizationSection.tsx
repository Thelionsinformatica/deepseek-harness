/** Leon Personalization settings page. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_PERSONALIZATION,
  MAX_CUSTOM_INSTRUCTIONS,
  type PersonalMemorySettings,
  type PersonalizationSettings,
  type Personality,
} from '../personalization-settings.ts'
import type { PersonalizationKey } from './locales.ts'
import css from './PersonalizationSection.module.css'

/** Host and service operations injected into the settings page. */
export interface PersonalizationSectionInjected {
  hooks: {
    personalization: SettingsScope<PersonalizationSettings>
    personalMemory: SettingsScope<PersonalMemorySettings>
    sessions: {
      getSnapshot: () => { current: SessionId | undefined }
      subscribe: (listener: () => void) => () => void
    }
  }
  saveInstructions: (instructions: string) => Promise<void>
  setPersonality: (personality: Personality) => Promise<void>
  setToolAssistedMemory: (enabled: boolean) => Promise<void>
  setPersonalMemoryEnabled: (enabled: boolean) => Promise<void>
  clearPersonalMemories: (sessionId: SessionId) => Promise<number>
  t: (key: PersonalizationKey, params?: Record<string, string>) => string
}

export type PersonalizationSectionProps = Partial<InjectFace<PersonalizationSectionInjected>>
type PersonalizationSectionFace = InjectFace<PersonalizationSectionInjected>

const PERSONALITY_OPTIONS: readonly { value: Personality; label: PersonalizationKey }[] = [
  { value: 'leon', label: 'personalityLeon' },
  { value: 'friendly', label: 'personalityFriendly' },
  { value: 'professional', label: 'personalityProfessional' },
  { value: 'direct', label: 'personalityDirect' },
  { value: 'creative', label: 'personalityCreative' },
]

/** Accessible binary preference control. */
function Switch({ checked, disabled, label, onChange }: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className={css.switch}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { onChange(!checked) }}
    >
      <span className={css.switchThumb} />
    </button>
  )
}

/** Render the page once all injected faces are available. */
function Loaded({
  usePersonalization,
  usePersonalMemory,
  useSessions,
  saveInstructions,
  setPersonality,
  setToolAssistedMemory,
  setPersonalMemoryEnabled,
  clearPersonalMemories,
  t,
}: PersonalizationSectionFace): ReactNode {
  const personalization = usePersonalization(value => value)
  const personalMemory = usePersonalMemory(value => value)
  const sessionId = useSessions(value => value.current)
  const current = personalization.value ?? DEFAULT_PERSONALIZATION
  const memoryEnabled = personalMemory.value?.enabled ?? false
  const [draft, setDraft] = useState(current.customInstructions)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setDraft(current.customInstructions)
  }, [current.customInstructions, personalization.revision])

  const canWritePersonalization = personalization.status === 'ready' && personalization.writable
  const canWriteMemory = personalMemory.status === 'ready' && personalMemory.writable

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(false)
    try {
      await operation()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    setSaving(true)
    setSaved(false)
    setError(false)
    void saveInstructions(draft.trim()).then(
      () => { setSaved(true) },
      () => { setError(true) },
    ).finally(() => { setSaving(false) })
  }

  const removeAll = (): void => {
    if (sessionId === undefined) return
    setDeleting(true)
    setError(false)
    void clearPersonalMemories(sessionId).then(
      (count) => {
        setFeedback(t('deleteDone', { count: String(count) }))
        setConfirmDelete(false)
      },
      () => { setError(true) },
    ).finally(() => { setDeleting(false) })
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>

      <section className={css.block}>
        <div className={css.blockHeading}>
          <h3>{t('instructionsTitle')}</h3>
          <p>{t('instructionsDescription')}</p>
        </div>
        <label className={css.hiddenLabel} htmlFor="leon-custom-instructions">{t('instructionsLabel')}</label>
        <textarea
          id="leon-custom-instructions"
          className={css.instructions}
          rows={9}
          maxLength={MAX_CUSTOM_INSTRUCTIONS}
          value={draft}
          disabled={!canWritePersonalization || saving}
          placeholder={t('instructionsPlaceholder')}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setSaved(false)
          }}
        />
        <div className={css.saveRow}>
          {personalization.status === 'unavailable' ? <span className={css.muted}>{t('unavailable')}</span> : null}
          {personalization.status === 'ready' && !personalization.writable ? <span className={css.muted}>{t('readOnly')}</span> : null}
          {saved ? <span className={css.success} role="status">{t('saved')}</span> : null}
          <button
            type="button"
            className={css.primaryButton}
            disabled={!canWritePersonalization || saving || draft.trim() === current.customInstructions}
            onClick={save}
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </section>

      <section className={css.block}>
        <div className={css.blockHeading}>
          <h3>{t('memoryTitle')}</h3>
          <p>{t('memoryDescription')}</p>
        </div>
        <div className={css.card}>
          <div className={css.row}>
            <div>
              <strong>{t('memoryEnabledTitle')}</strong>
              <p>{t('memoryEnabledDescription')}</p>
            </div>
            <Switch
              checked={memoryEnabled}
              disabled={!canWriteMemory || busy}
              label={t('memoryEnabledTitle')}
              onChange={(enabled) => { void run(() => setPersonalMemoryEnabled(enabled)) }}
            />
          </div>
          <div className={css.row}>
            <div>
              <strong>{t('toolMemoryTitle')}</strong>
              <p>{t('toolMemoryDescription')}</p>
            </div>
            <Switch
              checked={current.toolAssistedMemory}
              disabled={!canWritePersonalization || busy}
              label={t('toolMemoryTitle')}
              onChange={(enabled) => { void run(() => setToolAssistedMemory(enabled)) }}
            />
          </div>
          <div className={css.row}>
            <div>
              <strong>{t('deleteMemoryTitle')}</strong>
              <p>{t('deleteMemoryDescription')}</p>
              {sessionId === undefined ? <span className={css.muted}>{t('deleteNeedsSession')}</span> : null}
            </div>
            <button
              type="button"
              className={css.dangerButton}
              disabled={sessionId === undefined || deleting}
              onClick={() => { setConfirmDelete(true) }}
            >
              {t('delete')}
            </button>
          </div>
        </div>
      </section>

      <aside className={css.compatibility}>
        <span aria-hidden="true">!</span>
        <div>
          <strong>{t('compatibilityTitle')}</strong>
          <p>{t('compatibilityDescription')}</p>
        </div>
      </aside>

      <section className={css.personalityRow}>
        <div>
          <strong>{t('personalityTitle')}</strong>
          <p>{t('personalityDescription')}</p>
        </div>
        <label className={css.hiddenLabel} htmlFor="leon-personality">{t('personalityLabel')}</label>
        <select
          id="leon-personality"
          className={css.select}
          value={current.personality}
          disabled={!canWritePersonalization || busy}
          onChange={(event) => {
            const personality = event.currentTarget.value as Personality
            void run(() => setPersonality(personality))
          }}
        >
          {PERSONALITY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{t(option.label)}</option>
          ))}
        </select>
      </section>

      {feedback !== null ? <p className={css.success} role="status">{feedback}</p> : null}
      {error ? <p className={css.error} role="alert">{t('operationFailed')}</p> : null}

      <Modal
        open={confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(false) }}
        title={t('deleteDialogTitle')}
        closeLabel={t('cancel')}
        description={t('deleteDialogDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={() => { setConfirmDelete(false) }}>
              {t('cancel')}
            </Button>
            <Button variant="outline" className={css.deleteConfirm} disabled={deleting} onClick={removeAll}>
              {deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}

/** Slot entry with a null-safe HMR/load boundary. */
export function PersonalizationSection(props: PersonalizationSectionProps): ReactNode {
  const {
    usePersonalization, usePersonalMemory, useSessions, saveInstructions,
    setPersonality, setToolAssistedMemory, setPersonalMemoryEnabled,
    clearPersonalMemories, t,
  } = props
  if (
    usePersonalization === undefined || usePersonalMemory === undefined || useSessions === undefined
    || saveInstructions === undefined || setPersonality === undefined || setToolAssistedMemory === undefined
    || setPersonalMemoryEnabled === undefined || clearPersonalMemories === undefined || t === undefined
  ) return null
  return <Loaded {...{
    usePersonalization, usePersonalMemory, useSessions, saveInstructions,
    setPersonality, setToolAssistedMemory, setPersonalMemoryEnabled,
    clearPersonalMemories, t,
  }} />
}
