/** Conservative credential checks shared by every durable memory boundary. */

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

/**
 * Detect credential-like content before durable memory persistence or recall.
 * This is defense in depth rather than a general data-loss-prevention system.
 * @param content - Candidate or memory text inspected locally.
 * @returns whether a conservative credential signature matched.
 */
export function isCredentialLikeMemoryContent(content: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(content))
}
