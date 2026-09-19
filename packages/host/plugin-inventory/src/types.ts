import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** Coarse, non-secret purpose classification derived from the public module identity. */
export type PluginInventoryCategory =
  | 'web-provider'
  | 'tool'
  | 'client-interface'
  | 'host-runtime'
  | 'agent-runtime'
  | 'extension'
  | 'other'

/** How this installed entry may be managed from the Plugin Center. */
export type PluginActivationMode =
  /** An explicitly allow-listed optional entry can change for this running process only. */
  | 'live-toggle'
  /** The entry can be inspected but configuration must change through its owned settings or a restart. */
  | 'restart-required'
  /** Core, security, or transport ownership makes generic control unsafe. */
  | 'protected'

/** One non-group Loader entry exposed to trusted clients without raw configuration or secrets. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Safe module identity; local paths, URLs, and configuration-shaped values are redacted. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** Public high-level purpose inferred from the module identity. */
  readonly category: PluginInventoryCategory
  /** Brief non-secret description intended for the Plugin Center. */
  readonly summary: string
  /** Public capability labels; never derived from raw plugin configuration. */
  readonly capabilities: readonly string[]
  /** Conservative classification of the available control surface. */
  readonly activation: PluginActivationMode
  /** Human-readable reason for the activation classification and rollback behavior. */
  readonly activationReason: string
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}
