/** Installed skills and durable availability preferences for one agent profile. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillSettingsController } from './settings-controller.ts'
import css from './SkillSettingsSection.module.css'

/** Registration-side operations; components never reach services directly. */
export interface SkillSettingsInjected {
  hooks: { skillSettings: SkillSettingsController['store'] }
  load: SkillSettingsController['load']
  selectPreset: SkillSettingsController['selectPreset']
  selectWorkspace: SkillSettingsController['selectWorkspace']
  setEnabled: SkillSettingsController['setEnabled']
}

/** Four-share props supplied by the Settings slot renderer. */
export type SkillSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'skill'> & InjectFace<SkillSettingsInjected>

/**
 * Render installed skills without installation or invocation actions.
 * @param props - framework hooks, translated copy, and Host-backed callbacks.
 * @returns the profile skill settings page.
 */
export function SkillSettingsSection({
  useSkillSettings, useWorkspaces, load, selectPreset, selectWorkspace, setEnabled, t,
}: SkillSettingsSectionProps) {
  const state = useSkillSettings(value => value)
  const workspaces = useWorkspaces(value => value.items)
  useEffect(() => { void load() }, [load])
  const saving = state.savingName !== null
  const loading = state.status === 'idle' || state.status === 'loading'
  const catalog = state.catalog
  const canWrite = state.status === 'ready' && catalog?.writable === true && !saving
  const workspaceMissing = state.workspaceId !== undefined && !workspaces.some(item => item.workspaceId === state.workspaceId)

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('settings.title')}</h2>
      <p className={css.intro}>{t('settings.description')}</p>
      <div className={css.filters}>
        <label className={css.field}>
          <span>{t('settings.profile')}</span>
          <select value={state.agentPreset} disabled={saving || state.presets.length === 0}
            onChange={(event) => { void selectPreset(event.target.value) }}>
            {state.agentPreset === '' ? <option value="">{t('settings.chooseProfile')}</option> : null}
            {state.presets.map(preset => (
              <option key={preset.id} value={preset.id} disabled={preset.broken !== undefined}>
                {preset.name ?? preset.id} ({preset.id}){preset.isDefault ? ` · ${t('settings.defaultProfile')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('settings.workspace')}</span>
          <select value={state.workspaceId ?? ''} disabled={saving}
            onChange={(event) => {
              const id = workspaces.find(item => item.workspaceId === event.target.value)?.workspaceId
              void selectWorkspace(id)
            }}>
            <option value="">{t('settings.profileRoots')}</option>
            {workspaceMissing ? <option value={state.workspaceId} disabled>{t('settings.workspaceMissing')}</option> : null}
            {workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => { void load() }}>
          {t('settings.refresh')}
        </Button>
      </div>
      <p className={css.note}>{t('settings.scopeHint')}</p>
      <p className={css.note}>{t('settings.effectHint')}</p>
      {state.error !== null ? <p className={css.error} role="alert">{t('settings.error')} {state.error}</p> : null}
      {loading ? <p role="status">{t('settings.loading')}</p> : null}
      {!loading && state.agentPreset === '' ? <p>{t('settings.noProfiles')}</p> : null}
      {catalog !== undefined ? (
        <>
          {!catalog.complete ? <p className={css.notice} role="status">{t('settings.incomplete')}</p> : null}
          {!catalog.writable ? <p className={css.note}>{t('settings.readOnly')}</p> : null}
          {!loading && catalog.skills.length === 0 ? <p>{t(catalog.complete ? 'settings.empty' : 'settings.emptyIncomplete')}</p> : null}
          <ul className={css.list} aria-label={t('settings.installed')} aria-busy={loading || saving}>
            {catalog.skills.map(skill => (
              <li className={css.skill} key={skill.name}>
                <div className={css.detail}>
                  <h3 className={css.name}>{skill.name}</h3>
                  <p className={css.description}>{skill.description}</p>
                  <p className={css.metadata}>{t('settings.source')}: {skill.source}</p>
                  <p className={css.metadata}>
                    {t('settings.model')}: {t(skill.modelInvocable ? 'settings.allowed' : 'settings.restricted')}
                    {' · '}{t('settings.user')}: {t(skill.userInvocable ? 'settings.allowed' : 'settings.restricted')}
                  </p>
                </div>
                <div className={css.control}>
                  <button type="button" role="switch" className={css.switch}
                    aria-label={skill.name} aria-checked={skill.enabled} disabled={!canWrite}
                    onClick={() => { void setEnabled(skill.name, !skill.enabled) }}>
                    <span className={css.thumb} />
                  </button>
                  <span className={css.metadata} role={state.savingName === skill.name ? 'status' : undefined}>
                    {t(state.savingName === skill.name ? 'settings.saving' : skill.enabled ? 'settings.enabled' : 'settings.disabled')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
