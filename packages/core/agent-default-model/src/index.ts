/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { auxiliaryPolicySchema, auxiliarySettingsSchema } from './auxiliary.ts'
import type { AuxiliaryModelPolicy, AuxiliaryModelRole, AuxiliaryModelSettings } from './auxiliary.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Explicit normal-profile auxiliary routing policy; omitted in frozen laboratories. */
  auxiliaryModels?: AuxiliaryModelPolicy
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
    auxiliaryModels: auxiliaryPolicySchema,
  })

  private source: () => AgentDefaultModelSettings
  private auxiliarySource: (() => AuxiliaryModelSettings) | undefined
  private readonly localProviders: ReadonlySet<string>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    this.localProviders = new Set(config.auxiliaryModels?.localProviders)
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through currentSelection(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })
    if (config.auxiliaryModels !== undefined) {
      const roles = config.auxiliaryModels.roles ?? {}
      this.auxiliarySource = () => roles
      installSettingsSection(ctx, settingsNamespace('agent-model-roles'), auxiliarySettingsSchema, roles, {
        setSource: (current) => { this.auxiliarySource = current },
        onChange: () => {},
      })
    }
  }

  /**
   * Resolve a configured auxiliary route before the consumer logs and dispatches it.
   * @param role - fixed host-assigned function, never a participant display name.
   * @returns a detached selection, or undefined to preserve existing inheritance.
   * @throws when an external route lacks explicit consent or a route is incomplete.
   */
  auxiliarySelection(role: AuxiliaryModelRole): ModelSelection | undefined {
    const route = this.auxiliarySource?.()[role]
    if (route === undefined) return undefined
    if (!route.provider.trim() || !route.model.trim()) throw new Error(`Incomplete auxiliary route: ${role}`)
    if (!this.localProviders.has(route.provider) && route.allowExternal !== true) {
      throw new Error(`External auxiliary route requires explicit consent: ${role}`)
    }
    return selection(route)
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }
}

export default AgentDefaultModelConfig
