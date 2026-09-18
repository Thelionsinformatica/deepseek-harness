/** Real model assignments over the host settings API; never launches inference. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelAssignments.module.css'
import sharedStyles from './ModelsSection.module.css'

type Copy = (key: keyof typeof en) => string
interface Route { provider: string; model: string; reasoningEffort?: string; allowExternal?: boolean }
type Role = 'title' | 'compression' | 'vision' | 'worker' | 'review'
const roles: readonly { id: Role; label: keyof typeof en }[] = [
  { id: 'title', label: 'roleTitle' }, { id: 'compression', label: 'roleCompression' },
  { id: 'vision', label: 'roleVision' }, { id: 'worker', label: 'roleWorker' }, { id: 'review', label: 'roleReview' },
]

/** Read only the non-secret route fields of the settings wire document. */
function routeOf(value: unknown): Route | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const route = value as Record<string, unknown>
  if (typeof route['provider'] !== 'string' || typeof route['model'] !== 'string') return undefined
  return {
    provider: route['provider'], model: route['model'],
    ...typeof route['reasoningEffort'] === 'string' ? { reasoningEffort: route['reasoningEffort'] } : {},
    ...route['allowExternal'] === true ? { allowExternal: true } : {},
  }
}

interface Props {
  state: ModelsSettingsState
  controller: ModelsSettingsStore
  api: Pick<IApiClient, 'settings'>
  t: Copy
}

/** Render the main selection, independent consumers and honest collaboration boundary. */
export function ModelAssignments({ state, controller, api, t }: Props): ReactNode {
  const main = state.namespaces.get('agent-default-model')
  const auxiliary = state.namespaces.get('agent-model-roles')
  useEffect(() => { if (main !== undefined) void controller.loadCatalog() }, [controller, main !== undefined])
  const [notice, setNotice] = useState('')
  const [resetting, setResetting] = useState(false)
  if (main === undefined) return null
  const values = auxiliary?.value as Record<string, unknown> | undefined
  const resetAll = async (): Promise<void> => {
    if (auxiliary === undefined) return
    setResetting(true)
    try {
      const result = await api.settings.replace({ ns: auxiliary.ns, section: {}, expectedRevision: auxiliary.revision })
      if (!result.result.ok) throw new Error(result.result.error.message)
      await controller.load()
      setNotice(t('roleSaved'))
    } catch (error) { setNotice(messageOf(error)) }
    finally { setResetting(false) }
  }
  const row = (namespace: SettingsNamespaceView, role: Role | undefined, title: string, value: unknown): ReactNode => {
    const current = routeOf(value)
    return (
      <AssignmentRow key={role ?? 'main'} namespace={namespace} {...role === undefined ? {} : { role }}
        title={title} {...current === undefined ? {} : { current }}
        catalog={state.catalog ?? []} writable={state.writable} api={api} controller={controller} t={t} />
    )
  }
  return <div className={styles['panel']}>
    <section className={styles['card']} aria-label={t('mainModel')}>
      <h3>{t('mainModel')}</h3><p>{t('mainHelp')}</p>
      {row(main, undefined, t('mainModel'), main.value)}
      <button type="button" onClick={() => { void controller.loadCatalog() }}>{t('roleCatalog')}</button>
      <p className={styles['muted']}>{t('roleCatalogHelp')}</p>
      {state.catalogError ? <p role="alert">{state.catalogError}</p> : null}
    </section>
    <section className={styles['card']} aria-label={t('auxiliaryModels')}>
      <div className={styles['heading']}><h3>{t('auxiliaryModels')}</h3>
        <button type="button" disabled={!state.writable || auxiliary === undefined || resetting} onClick={() => { void resetAll() }}>{t('roleResetAll')}</button>
      </div><p>{t('auxiliaryHelp')}</p>
      {auxiliary === undefined ? <p>{t('rolesUnavailable')}</p> : roles.slice(0, 3).map(role => row(auxiliary, role.id, t(role.label), values?.[role.id]))}
    </section>
    <section className={styles['card']} aria-label={t('collaboration')}>
      <h3>{t('collaboration')}</h3><p>{t('collaborationHelp')}</p>
      {auxiliary === undefined ? null : roles.slice(3).map(role => row(auxiliary, role.id, t(role.label), values?.[role.id]))}
      <p className={styles['muted']}>{t('collaborationLimits')}</p>
      <p className={styles['muted']}>{t('rolePolicies')}</p>
    </section>
    {notice ? <p role="status">{notice}</p> : null}
  </div>
}

interface RowProps extends Pick<Props, 'api' | 'controller' | 't'> {
  namespace: SettingsNamespaceView
  role?: Role
  title: string
  current?: Route
  catalog: ModelProviderGroup[]
  writable: boolean
}

function AssignmentRow(props: RowProps): ReactNode {
  const { title, current, t } = props
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  return <div className={styles['row']}>
    <div className={styles['heading']}><div><strong>{title}</strong><p className={styles['route']}>
      {current === undefined ? t('roleInherited') : `${current.provider} / ${current.model} · ${current.reasoningEffort ?? t('roleProviderDefault')}`}
    </p></div><button type="button" disabled={!props.writable || props.catalog.length === 0} onClick={() => { setEditing(!editing); setNotice('') }}>{t('roleChange')}</button></div>
    {editing ? <RouteEditor {...props} onClose={(saved) => { setEditing(false); if (saved) setNotice(t('roleSaved')) }} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </div>
}

function RouteEditor(
  { namespace, role, current, catalog, writable, api, controller, t, onClose }: RowProps & { onClose: (saved: boolean) => void },
): ReactNode {
  const [provider, setProvider] = useState(current?.provider ?? catalog[0]?.id ?? '')
  const [model, setModel] = useState(current?.model ?? catalog[0]?.models[0]?.id ?? '')
  const [effort, setEffort] = useState(current?.reasoningEffort ?? '')
  const [consent, setConsent] = useState(current?.allowExternal === true)
  const [revision] = useState(namespace.revision)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const group = catalog.find(item => item.id === provider)
  const selected = group?.models.find(item => item.id === model)
  const external = provider !== 'llamacpp'
  const savedEffort = provider === current?.provider && model === current.model && effort === current.reasoningEffort
  const listedEffort = selected?.reasoning?.efforts.some(item => item.id === effort) === true
  const valid = selected !== undefined && (effort === '' || listedEffort || savedEffort)
  const save = async (clear = false): Promise<void> => {
    setSaving(true); setError('')
    try {
      const value = { provider, model, ...effort === '' ? {} : { reasoningEffort: effort }, ...role === undefined ? {} : { allowExternal: external && consent } }
      const response = role === undefined
        ? await api.settings.replace({ ns: namespace.ns, section: value, expectedRevision: revision })
        : await api.settings.mutate({ ns: namespace.ns, expectedRevision: revision, ops: [clear ? { op: 'unset', path: [role] } : { op: 'set', path: [role], value }] })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await controller.load()
      onClose(true)
    } catch (failure) { setError(messageOf(failure)) }
    finally { setSaving(false) }
  }
  return <div className={styles['editor']}>
    <label>{t('roleProvider')}<select className={sharedStyles['selectInput']} value={provider} disabled={saving || !writable} onChange={(event) => {
      setProvider(event.target.value); setModel(catalog.find(item => item.id === event.target.value)?.models[0]?.id ?? ''); setEffort(''); setConsent(false)
    }}>
      {group === undefined ? <option value={provider}>{provider}</option> : null}
      {catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label>{t('roleModel')}<select className={sharedStyles['selectInput']} value={model} disabled={saving || !writable} onChange={(event) => { setModel(event.target.value); setEffort(''); setConsent(false) }}>
      {selected === undefined ? <option value={model}>{model || '—'}</option> : null}{group?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label>{t('roleEffort')}<select className={sharedStyles['selectInput']} value={effort} disabled={saving || !writable} onChange={(event) => { setEffort(event.target.value) }}>
      <option value="">{t('roleProviderDefault')}</option>
      {effort !== '' && savedEffort && !listedEffort ? <option value={effort}>{effort}</option> : null}
      {selected?.reasoning?.efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {!valid ? <p role="alert">{t('roleMissing')}</p> : null}
    {external ? <><p className={styles['warning']}>{t('roleExternalWarning')}</p><label className={styles['consent']}>
      <input type="checkbox" checked={consent} disabled={saving || !writable} onChange={(event) => { setConsent(event.target.checked) }} />{t('roleExternalConsent')}
    </label></> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles['actions']}>
      <button type="button" disabled={saving || !writable || !valid || (external && !consent)} onClick={() => { void save() }}>{t('roleSave')}</button>
      {role !== undefined ? <button type="button" disabled={saving || !writable} onClick={() => { void save(true) }}>{t('roleReset')}</button> : null}
      <button type="button" disabled={saving} onClick={() => { onClose(false) }}>{t('roleCancel')}</button>
    </div>
  </div>
}
