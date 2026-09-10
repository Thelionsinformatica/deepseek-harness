/**
 * Safe, non-secret Plugin Center inventory over current Cordis Loader entries.
 *
 * The gateway has one narrow mutation path: only deployment-configured,
 * optional entry ids may be toggled for the current process. It deliberately
 * invokes Entry.update() directly instead of Loader.update(), so a click never
 * writes bundle, profile, or user patch files. Every other entry is detailed
 * but classified as restart-required or protected.
 */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginActivationMode,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryCategory,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** One deployment-audited target, identified in its Loader configuration tree. */
export interface LiveToggleEntry {
  /** Stable `Entry.options.id` within the containing Loader configuration tree. */
  id: string
  /** Exact public module identity, preventing a same-id entry elsewhere from inheriting the grant. */
  moduleName: string
}

/** Deployment-owned explicit allow-list for optional process-local toggles. */
export interface Config {
  /** Exact configuration id + module identity pairs audited as safe optional live toggles. */
  liveToggleEntries?: readonly LiveToggleEntry[]
}

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** A Loader group controls descendants and is never a generic runtime toggle. */
const STRUCTURAL_GROUP_REASON = 'Structural Loader groups are protected from generic controls.'
const UNSAFE_MODULE_REASON = 'Local paths, URLs, and configuration-shaped plugin identities are protected from generic controls.'

/** Public package/loader identities that cannot contain a local path, URL, or query. */
const PUBLIC_MODULE_SPECIFIER = /^(?:@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?)$/

/** Core, security, transport, and session ownership is never a generic toggle. */
const PROTECTED_MODULE_PREFIXES = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-api-',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-web-access',
  '@deepseek-ai/dsh-workspace',
] as const

/** Ids whose module identity is not enough to capture the transport/kernel role. */
const PROTECTED_ENTRY_IDS = new Set([
  'loader', 'modules', 'connection', 'api-remotes', 'client-runtime',
  'cordis-client-runner', 'web-runtime', 'webserver', 'typert', 'typert-loader', 'typert-gateway',
])

/** Remove local paths, URLs, queries, and other configuration-shaped identities from a Remote projection. */
function safeModuleName(moduleName: string): string {
  return PUBLIC_MODULE_SPECIFIER.test(moduleName) ? moduleName : 'local plugin'
}

/** Infer a useful but deliberately configuration-free category and description. */
function describe(moduleName: string): {
  category: PluginInventoryCategory
  summary: string
  capabilities: readonly string[]
} {
  if (moduleName.includes('web-search')) {
    return {
      category: 'web-provider',
      summary: 'Provides public web search results to the native Web tool.',
      capabilities: ['public web search', 'source grounding'],
    }
  }
  if (moduleName.includes('web-fetch')) {
    return {
      category: 'web-provider',
      summary: 'Retrieves public HTTP(S) pages for the native Web tool.',
      capabilities: ['public page fetch', 'response safety limits'],
    }
  }
  if (moduleName.includes('tool-')) {
    return {
      category: 'tool',
      summary: 'Adds a model-facing tool to its configured agent scope.',
      capabilities: ['model tool'],
    }
  }
  if (moduleName.includes('client-ui-')) {
    return {
      category: 'client-interface',
      summary: 'Contributes a browser interface surface to Leon Web.',
      capabilities: ['browser interface'],
    }
  }
  if (moduleName.includes('host-') || moduleName.includes('webserver')) {
    return {
      category: 'host-runtime',
      summary: 'Supports the local host runtime or browser transport.',
      capabilities: ['host runtime'],
    }
  }
  if (moduleName.includes('agent') || moduleName.includes('llm')) {
    return {
      category: 'agent-runtime',
      summary: 'Supports the current agent or model execution runtime.',
      capabilities: ['agent runtime'],
    }
  }
  if (moduleName.startsWith('@deepseek-ai/')) {
    return {
      category: 'extension',
      summary: 'Configured DeepSeek Harness extension.',
      capabilities: ['plugin extension'],
    }
  }
  return {
    category: 'other',
    summary: 'Configured Cordis plugin.',
    capabilities: ['plugin lifecycle'],
  }
}

/** Determine control eligibility without trusting module names supplied by a client. */
function activationOf(entry: Entry, liveToggleEntries: readonly LiveToggleEntry[]): {
  activation: PluginActivationMode
  activationReason: string
} {
  if (entry.options.group) {
    return { activation: 'protected', activationReason: STRUCTURAL_GROUP_REASON }
  }
  if (safeModuleName(entry.options.name) !== entry.options.name) {
    return { activation: 'protected', activationReason: UNSAFE_MODULE_REASON }
  }
  if (PROTECTED_ENTRY_IDS.has(entry.id)
    || PROTECTED_ENTRY_IDS.has(entry.options.id)
    || PROTECTED_MODULE_PREFIXES.some(prefix => entry.options.name.startsWith(prefix))) {
    return {
      activation: 'protected',
      activationReason: 'Core, security, session, or transport ownership is protected from generic controls.',
    }
  }
  if (liveToggleEntries.some(target => target.id === entry.options.id && target.moduleName === entry.options.name)) {
    return {
      activation: 'live-toggle',
      activationReason: 'Audited optional capability. The change is immediate for this process and automatically reverts on restart.',
    }
  }
  return {
    activation: 'restart-required',
    activationReason: 'This entry is visible for diagnosis. Change its owned configuration or restart after a reviewed deployment change.',
  }
}

/** Project a single Loader entry without exposing raw config, secrets, or source paths. */
function projectEntry(entry: Entry, liveToggleEntries: readonly LiveToggleEntry[]): PluginInventoryEntry {
  const moduleName = safeModuleName(entry.options.name)
  const detail = describe(moduleName)
  const control = activationOf(entry, liveToggleEntries)
  return {
    entryId: pluginEntryId(entry.id),
    moduleName,
    enabled: !entry.disabled,
    fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
    ...detail,
    ...control,
  }
}

/** Validate the deployment allow-list once at the host boundary. */
function toggleEntries(config: Config): readonly LiveToggleEntry[] {
  const entries = config.liveToggleEntries ?? []
  if (!Array.isArray(entries) || !entries.every((entry: unknown): entry is LiveToggleEntry => {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as Record<string, unknown>
    return typeof candidate.id === 'string'
      && candidate.id.length > 0
      && typeof candidate.moduleName === 'string'
      && candidate.moduleName.length > 0
      && safeModuleName(candidate.moduleName) === candidate.moduleName
  })) {
    throw new TypeError('plugin-inventory liveToggleEntries must contain non-empty public id and moduleName pairs')
  }
  return entries.map(entry => ({ id: entry.id, moduleName: entry.moduleName }))
}

/** Plugin Center Remote: inspect every entry; alter only explicit safe optional entries. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  private readonly liveToggleEntries: readonly LiveToggleEntry[]

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginInventory')
    this.liveToggleEntries = toggleEntries(config)
  }

  /**
   * Read Loader state directly on every call so no second lifecycle cache exists.
   * @returns current non-group entries in Loader order with safe management metadata.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push(projectEntry(entry, this.liveToggleEntries))
    }
    return { entries }
  }

  /**
   * Toggle one audited optional entry in memory. This never persists a change to
   * loader configuration, profile patches, or bundle files.
   * @param entryId - exact Loader entry selected from a preceding inventory snapshot.
   * @param enabled - desired effective state for the running process.
   * @returns the fresh entry projection after the lifecycle operation settles.
   */
  @Remote('setEnabled')
  async setEnabled(entryId: PluginEntryId, enabled: boolean): Promise<PluginInventoryEntry> {
    const entry = this.ctx.loader.resolve(entryId)
    const control = activationOf(entry, this.liveToggleEntries)
    if (control.activation !== 'live-toggle') {
      throw new Error(`plugin entry ${entry.id} cannot be toggled here: ${control.activationReason}`)
    }
    if ((!entry.disabled) === enabled) return projectEntry(entry, this.liveToggleEntries)
    // Entry.update() performs the Loader lifecycle transaction but (unlike
    // Loader.update()) deliberately does not call its parent tree's write().
    await entry.update({ disabled: !enabled }, false, true)
    const projected = projectEntry(entry, this.liveToggleEntries)
    if (projected.enabled !== enabled) {
      throw new Error(`plugin entry ${entry.id} is controlled by a disabled ancestor and cannot change independently`)
    }
    return projected
  }
}

export default PluginInventoryGateway
