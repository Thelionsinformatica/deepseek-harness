/**
 * skills domain contract: read-only skill catalog lookup addressed by session.
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
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

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). These
 * read-only catalogs never invoke a skill: invocation is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /** Inspects scoped metadata and loader visibility without authorizing execution or resuming an agent. */
  inspect(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SkillInspection>>
}
