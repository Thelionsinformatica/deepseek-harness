/**
 * Google Search grounding through the Gemini Interactions API. Each search is a stateless
 * auxiliary model request whose cited text and URL annotations become a normalized web result.
 * @module @deepseek-ai/dsh-web-search-google/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type {
  GoogleApiError,
  GoogleInteractionResponse,
  GoogleModelOutputStep,
  GoogleTextBlock,
  GoogleUrlCitation,
} from './types.ts'

/** Stable id this provider registers under. */
export const GOOGLE_SEARCH_PROVIDER_ID = 'google-grounding'

/** Gemini API base; `/interactions` is appended. */
export const GOOGLE_SEARCH_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Search-capable Gemini route already used by Leon's automatic expert tier. */
export const GOOGLE_SEARCH_DEFAULT_MODEL = 'gemini-3.6-flash'

/** Attribution header sent on every request. */
const USER_AGENT = 'leon-harness/0.1 (+https://github.com/Thelionsinformatica/deepseek-harness)'

/** Exact secret-free Gemini Interactions request recorded before dispatch. */
export interface GoogleSearchLlmRequest {
  /** Fully resolved Interactions endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to Gemini. */
  readonly body: {
    readonly model: string
    readonly input: string
    readonly tools: readonly [{ readonly type: 'google_search' }]
    readonly store: false
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary Gemini Google Search request recorded before dispatch. */
    'web/google-search-llm-request': GoogleSearchLlmRequest
  }
}

/** Resolved provider options for the next search operation. */
export interface GoogleSearchProviderOptions {
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Gemini API base; `/interactions` is appended. */
  baseURL: string
  /** Search-capable Gemini model id. */
  model: string
  /**
   * Record the exact secret-free request immediately before dispatch. A throw prevents
   * dispatch so auxiliary model input cannot escape logging.
   */
  recordRequest?: (request: GoogleSearchLlmRequest) => void
}

/** Return model-output steps from an interaction response. */
function outputSteps(response: GoogleInteractionResponse): GoogleModelOutputStep[] {
  return (response.steps ?? []).filter(
    (step): step is GoogleModelOutputStep => step.type === 'model_output',
  )
}

/** Return text blocks from one model-output step. */
function textBlocks(step: GoogleModelOutputStep): GoogleTextBlock[] {
  return (step.content ?? []).filter(block => block.type === 'text')
}

/** Derive the cited answer segment when the provider supplied valid text indexes. */
function citationSnippet(text: string, citation: GoogleUrlCitation): string | undefined {
  const start = citation.start_index
  const end = citation.end_index
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined
  if ((start as number) < 0 || (end as number) <= (start as number) || (end as number) > text.length) return undefined
  const snippet = text.slice(start as number, end as number).trim()
  return snippet.length > 0 ? snippet : undefined
}

/**
 * Map a Gemini Interactions response into grounded answer text plus deduplicated cited URLs.
 * The first title and cited segment for each URL win.
 *
 * @param response - parsed Gemini interaction response.
 * @returns normalized answer and sources.
 * @throws {@link WebError} when Gemini returns no model text.
 */
export function mapGoogleInteraction(response: GoogleInteractionResponse): WebSearchResult {
  const blocks = outputSteps(response).flatMap(textBlocks)
  const texts = blocks.flatMap(block => block.text != null && block.text.length > 0 ? [block.text] : [])
  if (texts.length === 0) {
    throw new WebError('Gemini Google Search returned no model output text', 'WEB_PROVIDER_ERROR')
  }

  const byUrl = new Map<string, WebSearchSource>()
  for (const block of blocks) {
    const text = block.text ?? ''
    for (const citation of block.annotations ?? []) {
      if (citation.type !== 'url_citation' || citation.url.length === 0 || byUrl.has(citation.url)) continue
      const snippet = citationSnippet(text, citation)
      byUrl.set(citation.url, {
        url: citation.url,
        ...citation.title != null && citation.title.length > 0 ? { title: citation.title } : {},
        ...snippet !== undefined ? { snippet } : {},
      })
    }
  }

  return {
    content: texts.join('\n\n'),
    sources: [...byUrl.values()],
    truncated: false,
  }
}

/** Google-backed search provider; HTTP redirects fail before reaching their target. */
export class GoogleSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_SEARCH_PROVIDER_ID

  /**
   * @param resolveOptions - options for the next operation, snapshotted once at entry so a
   * settings change cannot mix one credential with another endpoint.
   */
  constructor(private readonly resolveOptions: () => GoogleSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.trim().length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const endpoint = `${options.baseURL.replace(/\/$/u, '')}/interactions`
    const resultCap = request.maxResults === undefined ? '' : ` Return at most ${String(request.maxResults)} sources.`
    const body: GoogleSearchLlmRequest['body'] = {
      model: options.model,
      input: `Search the public web for this query: ${request.query}.${resultCap} Return a concise factual synthesis supported by the cited pages.`,
      tools: [{ type: 'google_search' }],
      store: false,
    }
    options.recordRequest?.({ endpoint, body })
    throwIfSearchAborted(signal)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'x-goog-api-key': apiKey,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Gemini Google Search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Gemini API error (HTTP ${String(status)})`
      try {
        const parsed = await response.json() as GoogleApiError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapGoogleInteraction(await response.json() as GoogleInteractionResponse)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Gemini Google Search returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /** Resolve one operation's credential without retaining it on the provider. */
  private async apiKey(options: GoogleSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Gemini Google Search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'GOOGLE_API_KEY'
    throw new WebError(
      `Gemini Google Search has no API key for "${ref}"; store it on the Models page or export it in the launching environment`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** Race asynchronous credential resolution against caller cancellation. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Gemini Google Search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
