/** Conservative credential and sensitive-topic checks for model-facing memory boundaries. */

import { isCredentialLikeMemoryContent } from '@deepseek-ai/dsh-memory'

const REVIEW_PATTERNS = [
  /\b(?:cpf|cnpj|rg|cart[aã]o|banco|financeir|pix|fatura|sal[aá]rio)\b/i,
  /\b(?:m[eé]dico|sa[uú]de|diagn[óo]stic|medicamento)\b/i,
]

/**
 * Detect credential-like content before memory persistence or recall.
 * @param content - Candidate or memory text inspected locally.
 * @returns whether a conservative credential signature matched.
 */
export function looksSensitive(content: string): boolean {
  return isCredentialLikeMemoryContent(content)
}

/**
 * Identify non-credential personal topics that require human review before durable storage.
 * @param content - Candidate text inspected locally.
 * @returns whether the text requires explicit human review.
 */
export function requiresSensitiveReview(content: string): boolean {
  return REVIEW_PATTERNS.some(pattern => pattern.test(content))
}
