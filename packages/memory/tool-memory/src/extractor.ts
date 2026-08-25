/** Deterministic, local-only extraction of reviewable memory candidates from user messages. */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { looksSensitive, requiresSensitiveReview } from './sensitivity.ts'
import type { MemoryCandidateCategory, MemoryCandidateSensitivity } from './spec.ts'

/** One bounded candidate proposed for local review without changing durable memory. */
export interface ExtractedMemoryCandidate {
  readonly content?: string
  readonly category: MemoryCandidateCategory
  readonly confidence: number
  readonly importance: number
  readonly sensitivity: MemoryCandidateSensitivity
  readonly scopeCandidate: 'workspace'
}

const MAX_CANDIDATE_CHARS = 2_048
const EXPLICIT_PREFIX = new RegExp([
  '^(?:leon\\s*[,;:]\\s*)?',
  '(?:(?:por favor|please)\\s*[,;:]?\\s*)?',
  '(?:lembre(?:-se)?|memorize|guarde|anote|registre|remember|record|note)',
  '(?:\\s+(?:de\\s+)?(?:que|that))?\\s+',
].join(''), 'iu')
const STABLE_MARKERS = [
  /\b(?:eu prefiro|minha preferencia e)\b/iu,
  /\b(?:a decisao (?:do projeto )?e|decidimos (?:que )?)\b/iu,
  /\b(?:o projeto usa|a configuracao e)\b/iu,
  /\b(?:i prefer|my preference is|we decided(?: that)?|the project uses)\b/iu,
]

/**
 * Extract at most one conservative candidate from the latest human-authored message.
 * @param messages - Proposed step messages; only the latest source-kind `user` text is inspected.
 * @returns a bounded local-review candidate, or `undefined` when no safe stable pattern matches.
 */
export function extractMemoryCandidate(messages: readonly UserMessage[]): ExtractedMemoryCandidate | undefined {
  const text = latestHumanText(messages)
  if (text === undefined) return undefined
  const explicit = EXPLICIT_PREFIX.test(text)
  if (!explicit && !STABLE_MARKERS.some(pattern => pattern.test(normalizeForMatching(text)))) return undefined
  const candidate = normalizeCandidate(explicit ? text.replace(EXPLICIT_PREFIX, '') : text)
  if (candidate === undefined) return undefined
  const category = classify(candidate)
  const sensitivity = looksSensitive(candidate)
    ? 'blocked'
    : requiresSensitiveReview(candidate) ? 'review' : 'none'
  return {
    ...(sensitivity === 'blocked' ? {} : { content: candidate }),
    category,
    confidence: explicit ? 0.95 : 0.82,
    importance: importanceOf(category),
    sensitivity,
    scopeCandidate: 'workspace',
  }
}

function latestHumanText(messages: readonly UserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.source.kind !== 'user') continue
    const text = message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return undefined
}

function normalizeCandidate(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_CANDIDATE_CHARS) return undefined
  return `${trimmed.charAt(0).toLocaleUpperCase('pt-BR')}${trimmed.slice(1)}`
}

function classify(content: string): MemoryCandidateCategory {
  const normalized = normalizeForMatching(content)
  if (/\b(?:prefiro|preferencia|i prefer|my preference)\b/u.test(normalized)) return 'preference'
  if (/\b(?:decisao|decidimos|decided)\b/u.test(normalized)) return 'decision'
  if (/\b(?:configuracao|porta|modelo|servidor|endpoint|url|diretorio|pasta|unidade)\b/u.test(normalized)) {
    return 'configuration'
  }
  if (/\b(?:sempre|procedimento|fluxo|passo|always|procedure|workflow)\b/u.test(normalized)) return 'procedure'
  return 'fact'
}

function normalizeForMatching(content: string): string {
  return content.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

function importanceOf(category: MemoryCandidateCategory): number {
  if (category === 'decision' || category === 'configuration') return 0.8
  if (category === 'preference' || category === 'procedure') return 0.7
  return 0.6
}
