/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, createUserMessage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/** Tags wrapping the structured summary inside the landed checkpoint node. */
const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'
const CONTINUITY_HEADING = '## Operational Continuity (deterministic)'
const MAX_CONTINUITY_REFERENCES = 16
const MAX_CONTINUITY_EVIDENCE = 6
const MAX_CONTINUITY_LINE_CHARS = 320

interface ContinuityFragment {
  readonly text: string
  readonly source: string
  readonly toolEvidence: boolean
}

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join('\n')

/** Framing that makes the replacement user message established context. */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's own system prompt, reused for prefix-cache alignment; absent for a system-less request. */
  readonly system?: string
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The shadowed region, in surface order, that precedes the compaction instruction. */
  readonly messages: readonly Message[]
}

/**
 * Preserve exact operational references independently of the summarizer model.
 * The bounded appendix carries only references and concise tool-result evidence;
 * it never promotes assistant prose to verified state. Credentials are redacted
 * and URL query strings or fragments are removed before retention.
 *
 * @param summary - text-only summary returned by the configured model.
 * @param messages - exact compacted messages from which references are recovered.
 * @returns summary blocks followed by a bounded deterministic appendix when facts exist.
 */
export function preserveOperationalContinuity(
  summary: readonly ContentBlock[],
  messages: readonly Message[],
): ContentBlock[] {
  const fragments = continuityFragments(messages)
  const references = latestReferences(fragments, MAX_CONTINUITY_REFERENCES)
  const evidence = latestUnique(fragments
    .filter(fragment => fragment.toolEvidence)
    .flatMap(fragment => evidenceLines(fragment)), MAX_CONTINUITY_EVIDENCE)
  if (references.length === 0 && evidence.length === 0) return [...summary]

  const lines = [
    CONTINUITY_HEADING,
    '- Machine-extracted recovery data. References are exact; live status is valid only when a tool-evidence line says so and must be revalidated after time or restart.',
    ...references.map(reference => `- Reference: ${reference}`),
    ...evidence.map(line => `- Tool evidence: ${line}`),
  ]
  return [...summary, { type: 'text', text: `\n\n${lines.join('\n')}` }]
}

/** Deduplicate references by exact value while retaining their latest source. */
function latestReferences(fragments: readonly ContinuityFragment[], limit: number): string[] {
  const latest = new Map<string, string>()
  for (const fragment of fragments) {
    for (const value of extractReferences(fragment)) {
      latest.delete(value)
      latest.set(value, `${value} (source: ${fragment.source})`)
    }
  }
  return [...latest.values()].slice(-limit)
}

/** Flatten model-visible text while retaining whether it came from a tool result. */
function continuityFragments(messages: readonly Message[]): ContinuityFragment[] {
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    collectToolNames(message.content, toolNames)
  }
  return messages.flatMap(message => collectContinuityFragments(
    message.content,
    sourceLabel(message),
    message.source.kind === 'tool',
    toolNames,
  ))
}

/** Associate a durable tool call id with its model-visible name. */
function collectToolNames(blocks: readonly ContentBlock[], names: Map<string, string>): void {
  for (const block of blocks) {
    if (block.type === 'tool-call') names.set(block.id, block.name)
    if (block.type === 'tool-result') collectToolNames(block.content, names)
  }
}

/** Convert a message producer into a terse appendix label. */
function sourceLabel(message: Message): string {
  switch (message.source.kind) {
    case 'user': return 'user'
    case 'model': return 'assistant'
    case 'tool': return 'tool result'
    case 'plugin': return message.source.plugin === 'dsh-compaction-basic'
      ? 'prior checkpoint'
      : `context ${message.source.plugin}`
    default: return 'context'
  }
}

/** Recursively collect text, tool arguments, and tool-result text without reasoning. */
function collectContinuityFragments(
  blocks: readonly ContentBlock[],
  source: string,
  toolEvidence: boolean,
  toolNames: ReadonlyMap<string, string>,
): ContinuityFragment[] {
  const fragments: ContinuityFragment[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      fragments.push({ text: redactSecrets(block.text), source, toolEvidence })
    } else if (block.type === 'tool-call') {
      fragments.push({
        text: redactSecrets(block.arguments),
        source: `tool call ${block.name}`,
        toolEvidence: false,
      })
    } else if (block.type === 'tool-result') {
      const name = toolNames.get(block.toolCallId)
      fragments.push(...collectContinuityFragments(
        block.content,
        name === undefined ? 'tool result' : `tool result ${name}`,
        true,
        toolNames,
      ))
    }
  }
  return fragments
}

/** Remove common credential assignments and standalone provider-key forms. */
function redactSecrets(text: string): string {
  return text
    .replace(/\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/\b(?:Bearer\s+)?(?:AIza[\w-]{20,}|sk-[\w-]{16,}|nvapi-[\w-]{16,}|gh[opusr]_[\w-]{16,})\b/gu, '[REDACTED]')
    .replace(/https?:\/\/[^\s<>{}\[\]"']+/giu, raw => safeUrl(raw) ?? '[REDACTED_URL]')
}

/** Extract safe URL and Windows-path references from one fragment. */
function extractReferences(fragment: ContinuityFragment): string[] {
  const values: string[] = []
  const urlPattern = /https?:\/\/[^\s<>{}\[\]"']+/giu
  const quotedWindowsPathPattern = /[`"']([a-z]:\\[^`"'\r\n]+)[`"']/giu
  const bareWindowsPathPattern = /\b[a-z]:\\[^\s`"'<>|?*,;\])}]+/giu

  for (const match of fragment.text.matchAll(urlPattern)) {
    const safe = safeUrl(match[0])
    if (safe !== undefined) values.push(safe)
  }
  for (const match of fragment.text.matchAll(quotedWindowsPathPattern)) {
    const path = normalizeWindowsPath(match[1] ?? '')
    if (path.length > 3) values.push(path)
  }
  for (const match of fragment.text.matchAll(bareWindowsPathPattern)) {
    const path = normalizeWindowsPath(match[0])
    if (path.length > 3) values.push(path)
  }
  return latestUnique(values, MAX_CONTINUITY_REFERENCES)
}

/** Strip credentials, query, and fragment from a parseable HTTP(S) reference. */
function safeUrl(raw: string): string | undefined {
  try {
    const url = new URL(trimReference(raw))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return trimReference(url.toString())
  } catch {
    return undefined
  }
}

/** Remove punctuation that belongs to surrounding prose instead of a reference. */
function trimReference(value: string): string {
  return value.replace(/[.,:;!?)\]}]+$/gu, '')
}

/** Decode JSON-escaped separators so a retained path is directly reusable. */
function normalizeWindowsPath(value: string): string {
  return trimReference(value).replace(/\\\\/gu, '\\')
}

/** Keep concise tool-result lines that carry observable process or endpoint state. */
function evidenceLines(fragment: ContinuityFragment): string[] {
  const statePattern = new RegExp([
    'https?://',
    '\\b[a-z]:\\\\',
    '\\bHTTP\\s+\\d{3}\\b',
    '\\bPID\\s*[:=]?\\s*\\d+\\b',
    '\\bport(?:a)?\\s*[:=]?\\s*\\d+\\b',
    '\\b(?:running|listening|started|active|executando|ouvindo|iniciado|aberto|ativo)\\b',
  ].join('|'), 'iu')
  return fragment.text.split(/\r?\n/u)
    .map(line => line.replace(/\s+/gu, ' ').trim())
    .filter(line => line.length > 0 && statePattern.test(line))
    .map(line => `${fragment.source}: ${boundLine(line)}`)
}

/** Bound one retained evidence line without splitting its provenance label. */
function boundLine(value: string): string {
  return value.length <= MAX_CONTINUITY_LINE_CHARS
    ? value
    : `${value.slice(0, MAX_CONTINUITY_LINE_CHARS - 1)}…`
}

/** Deduplicate by value while preferring the latest occurrence. */
function latestUnique(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>()
  const reversed: string[] = []
  for (let index = values.length - 1; index >= 0 && reversed.length < limit; index -= 1) {
    const value = values[index]
    if (value === undefined || seen.has(value)) continue
    seen.add(value)
    reversed.push(value)
  }
  return reversed.reverse()
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const assembler = new BlockAssembler()
  const messages: Message[] = [
    ...input.messages,
    createUserMessage({
      content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-basic' },
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.system === undefined ? {} : { system: input.system },
    ...input.tools === undefined ? {} : { tools: [...input.tools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

/**
 * Wrap raw summary blocks in the durable checkpoint framing.
 * @param summary - safe text-only model output.
 * @returns content for the synthesized replacement user message.
 */
export function frameSummary(summary: readonly ContentBlock[]): ContentBlock[] {
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ]
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}
