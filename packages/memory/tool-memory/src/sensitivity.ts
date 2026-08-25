/** Conservative credential and sensitive-topic checks for model-facing memory boundaries. */

const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bAIza[\w-]{20,}\b/,
  /\bAQ\.[\w-]{20,}\b/,
  /\bsk-(?:proj-)?[\w-]{16,}\b/i,
  /\bgh[pousr]_[\dA-Z]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/,
  /\b(?:api[ _-]?key|access[ _-]?token|secret|password)\b\s*(?:[:=]|\bis\b|\bé\b)\s*["']?[\w.~+\/-]{12,}/i,
  /\b(?:senha|chave de api|credencial)\b\s*(?:[:=]|\bé\b)\s*["']?[\w.~+\/-]{12,}/i,
]

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
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(content))
}

/**
 * Identify non-credential personal topics that require human review before durable storage.
 * @param content - Candidate text inspected locally.
 * @returns whether the text requires explicit human review.
 */
export function requiresSensitiveReview(content: string): boolean {
  return REVIEW_PATTERNS.some(pattern => pattern.test(content))
}
