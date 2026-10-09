/** Runtime constructors and validation for recovery adapter contracts. */

import type {
  RecoveryEventId as RecoveryEventIdentity,
  RecoveryOperationId as RecoveryOperationIdentity,
  RecoveryScopeKey as RecoveryScopeIdentity,
  ResolvedToolPolicy,
  ToolPolicy,
} from './types.ts'

/**
 * Construct a recovery scope key after the owner has normalized its components.
 * @param value - normalized scope identity.
 * @returns the branded recovery scope key.
 */
export function RecoveryScopeKey(value: string): RecoveryScopeIdentity {
  return value as RecoveryScopeIdentity
}

/**
 * Construct a stable recovery event identity.
 * @param value - stable event identity.
 * @returns the branded recovery event identity.
 */
export function RecoveryEventId(value: string): RecoveryEventIdentity {
  return value as RecoveryEventIdentity
}

/**
 * Construct a stable operation identity.
 * @param value - stable operation identity.
 * @returns the branded recovery operation identity.
 */
export function RecoveryOperationId(value: string): RecoveryOperationIdentity {
  return value as RecoveryOperationIdentity
}

/**
 * Validate and freeze one code-owned tool policy.
 * @param policy - static adapter policy.
 * @returns the same policy as an immutable registration value.
 */
export function defineToolPolicy(policy: ToolPolicy): ToolPolicy {
  if (policy.toolName.length === 0 || policy.toolName.trim() !== policy.toolName) {
    throw new TypeError('tool recovery policy name must be non-blank and have no surrounding whitespace')
  }
  if (!Number.isInteger(policy.canonicalizerVersion) || policy.canonicalizerVersion < 1) {
    throw new TypeError('tool recovery policy canonicalizerVersion must be an integer >= 1')
  }
  return Object.freeze(policy)
}

/**
 * Resolve one policy and reject incomplete adapter output before it reaches recovery state.
 * @param policy - validated static policy.
 * @param argumentsValue - parsed tool arguments.
 * @returns the complete invocation classification.
 */
export function resolveToolPolicy(policy: ToolPolicy, argumentsValue: unknown): ResolvedToolPolicy {
  const resolved = policy.resolve(argumentsValue)
  for (const [field, value] of [
    ['signature', resolved.signature],
    ['equivalenceFamily', resolved.equivalenceFamily],
    ['normalizedTarget', resolved.normalizedTarget],
  ] as const) {
    if (value.length === 0) throw new TypeError(`tool recovery policy returned blank ${field}`)
  }
  if (resolved.idempotencyKey !== undefined && resolved.idempotencyKey.length === 0) {
    throw new TypeError('tool recovery policy returned a blank idempotencyKey')
  }
  return Object.freeze({ ...resolved })
}
