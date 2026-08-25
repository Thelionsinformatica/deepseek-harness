import {
  MemoryPolicyDecision,
  MemoryPolicyReason,
  MemoryPolicyVersion,
  MEMORY_POLICY_VERSION,
} from '@deepseek-ai/dsh-memory'

import type { MemoryCandidateCategory, MemoryCandidateOperation, MemoryCandidateSensitivity } from './types.ts'

/** Inputs for deterministic candidate policy evaluation. */
export interface CandidatePolicyContext {
  readonly operation: MemoryCandidateOperation
  readonly query: string
  readonly total: number
  readonly omittedSensitive: number
  readonly inserted: number
  readonly confidence: number
  readonly topScore: number
}

/** Deterministic outcome for one candidate extraction event. */
export interface CandidatePolicyDecision {
  readonly policyVersion: MemoryPolicyVersion
  readonly decision: MemoryPolicyDecision
  readonly reason: MemoryPolicyReason
}

/** Content-free inputs used to classify a newly extracted shadow candidate. */
export interface ExtractedCandidatePolicyContext {
  readonly category: MemoryCandidateCategory
  readonly confidence: number
  readonly importance: number
  readonly sensitivity: MemoryCandidateSensitivity
}

const ABSOLUTE_CREDENTIAL_PATTERNS = [
  /\bAIza[\w-]{20,}\b/i,
  /\bAQ\.[\w-]{20,}\b/i,
  /\bsk-(?:proj-)?[\w-]{16,}\b/i,
  /\bgh[pousr]_[\dA-Z]{20,}\b/i,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/,
]

const SENSITIVE_QUERY_PATTERNS = [
  /\b(senha|chave|token|api[_ ]?key|credencial|secret|password|private key|access key|jwt|cookie)\b/i,
  /\b(cpf|cnpj|rg|cart[aã]o|banco|financeir|pix|fatura|sal[aá]rio)\b/i,
  /\b(m[eé]dico|sa[uú]de|diagn[óo]stic|medic)\b/i,
]

/**
 * Select the deterministic policy outcome for one recall or search candidate trace.
 * @param context - bounded candidate counts, scores, query, and operation provenance.
 * @returns the versioned policy decision and its stable reason.
 */
export function evaluateCandidatePolicy(context: CandidatePolicyContext): CandidatePolicyDecision {
  if (context.total <= 0 || context.inserted < 1) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'reject',
      reason: context.total <= 0 ? 'no-candidates' : 'all-candidates-sensitive',
    }
  }

  if (containsAbsoluteCredentialSignal(context.query)) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'block',
      reason: 'credential-signal',
    }
  }

  if (context.total > 20 || context.confidence <= 0.15 || context.topScore <= 0.12) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'reject',
      reason: 'low-confidence',
    }
  }

  if (containsSensitiveIntention(context.query) || context.omittedSensitive > 0) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'confirm',
      reason: 'sensitivity-review-required',
    }
  }

  if (
    context.topScore >= 0.78 &&
    context.confidence >= 0.85 &&
    context.inserted <= 4 &&
    context.total <= 10 &&
    context.operation !== 'tool_call_memory_search'
  ) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'store',
      reason: 'high-confidence',
    }
  }

  if (
    context.topScore >= 0.72 &&
    context.confidence >= 0.78 &&
    context.inserted <= 3 &&
    context.total <= 8
  ) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'store',
      reason: 'high-confidence',
    }
  }

  if (context.confidence < 0.3 || context.topScore < 0.35) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'reject',
      reason: 'low-confidence',
    }
  }

  return {
    policyVersion: MEMORY_POLICY_VERSION,
    decision: 'shadow',
    reason: 'moderate-confidence',
  }
}

/**
 * Select the deterministic review recommendation for an extracted candidate.
 * @param context - bounded classifier metadata; candidate text is intentionally absent.
 * @returns the versioned block, reject, shadow, confirm, or store recommendation.
 */
export function evaluateExtractedCandidatePolicy(
  context: ExtractedCandidatePolicyContext,
): CandidatePolicyDecision {
  if (context.sensitivity === 'blocked') {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'block',
      reason: 'credential-signal',
    }
  }
  if (context.sensitivity === 'review') {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'confirm',
      reason: 'sensitivity-review-required',
    }
  }
  if (context.confidence < 0.65 || context.importance < 0.5) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'reject',
      reason: 'low-confidence',
    }
  }
  if (
    context.confidence >= 0.9
    && context.importance >= 0.7
    && context.category !== 'fact'
  ) {
    return {
      policyVersion: MEMORY_POLICY_VERSION,
      decision: 'store',
      reason: 'high-confidence',
    }
  }
  return {
    policyVersion: MEMORY_POLICY_VERSION,
    decision: 'shadow',
    reason: 'candidate-extracted',
  }
}

function containsAbsoluteCredentialSignal(query: string): boolean {
  return ABSOLUTE_CREDENTIAL_PATTERNS.some(pattern => pattern.test(query))
}

function containsSensitiveIntention(query: string): boolean {
  return SENSITIVE_QUERY_PATTERNS.some(pattern => pattern.test(query))
}
