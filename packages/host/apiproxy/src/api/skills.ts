/**
 * Read-only skill discovery addressed by session or administrative preset and
 * registered workspace. The host resolves project paths; lookup never creates
 * or resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/** Path-free invocation metadata from the session's effective skill catalog. */
export interface SkillInspectionEntry {
  /** Skill identifier. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Standard discovery source category; provider-specific labels are reported as custom. */
  readonly source: string
  /** Skill discovery policy and live loader visibility; not execution authorization. */
  readonly modelInvocable: boolean
  /** Whether skill policy permits explicit user invocation, independent of model-tool visibility. */
  readonly userInvocable: boolean
}

/** Read-only observation of one session's skill catalog and loader visibility. */
export interface SkillInspection {
  /** Latest logged preset selection, or null when the session records none. */
  readonly agentPreset: string | null
  /** Discovery completed and the live agent's tool visibility was verified without resuming it. */
  readonly complete: boolean
  /** The live agent resolves this registry's registered skill loader; false when unavailable or not verifiable. */
  readonly modelToolAvailable: boolean
  /** Inspection never runs execution guards or asks for approval; authorization remains unevaluated. */
  readonly authorization: 'not-evaluated'
  /** Invocation-neutral winning catalog, scoped to this session alone. */
  readonly skills: readonly SkillInspectionEntry[]
  /** ISO timestamp at the end of this observation. */
  readonly observedAt: string
}

/** Path-free installed skill metadata for the administrative preset catalog. */
export interface SkillCatalogEntry extends SkillInspectionEntry {
  /** Whether this preset's current restrictions permit the skill. */
  readonly enabled: boolean
}

/** Administrative inventory, including disabled skills, without executing them. */
export interface SkillCatalog {
  /** Preset whose standing composition supplies this inventory. */
  readonly agentPreset: string
  /** All providers completed and settings stayed at the returned revision. */
  readonly complete: boolean
  /** Metadata only; invocation flags describe policy, not tool authorization. */
  readonly skills: readonly SkillCatalogEntry[]
  /** Revision of the agent-presets namespace for settings.mutate CAS writes. */
  readonly revision: number
  /** A settings provider can persist edits to the registered namespace. */
  readonly writable: boolean
  /** Configured disabled names, including skills absent from this observation. */
  readonly disabledNames: readonly string[]
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). These
 * read-only catalogs never invoke a skill: invocation is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
export interface SkillsApi {
  /**
   * Loopback-only installed inventory for one preset, with no session required.
   * An optional registered workspace selects project skills; omission leaves
   * cwd unset. This may mount the preset's standing plugins, but starts no agent.
   */
  catalog(request: RpcRequest<{ agentPreset: string; workspaceId?: string }>): Promise<RpcResponse<SkillCatalog>>
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /** Inspects scoped metadata and loader visibility without authorizing execution or resuming an agent. */
  inspect(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SkillInspection>>
}
