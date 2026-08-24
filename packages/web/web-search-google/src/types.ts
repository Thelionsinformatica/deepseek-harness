/**
 * Provider-private wire types for the Gemini Interactions API Google Search response.
 * @module @deepseek-ai/dsh-web-search-google/types
 */

/** One URL citation attached to a generated text block. */
export interface GoogleUrlCitation {
  type: 'url_citation'
  url: string
  title?: string | null
  start_index?: number | null
  end_index?: number | null
}

/** One text block returned inside a model-output step. */
export interface GoogleTextBlock {
  type: 'text'
  text?: string | null
  annotations?: GoogleUrlCitation[]
}

/** A model-output step carrying grounded prose and citations. */
export interface GoogleModelOutputStep {
  type: 'model_output'
  content?: GoogleTextBlock[]
}

/** Any interaction step; only model output and search-call tags are consumed. */
export type GoogleInteractionStep =
  | GoogleModelOutputStep
  | { type: 'google_search_call'; arguments?: { queries?: string[] } }
  | { type: string }

/** Gemini Interactions API response envelope used by this provider. */
export interface GoogleInteractionResponse {
  status?: string
  steps?: GoogleInteractionStep[]
}

/** Gemini API error response envelope. */
export interface GoogleApiError {
  error?: {
    code?: number
    message?: string
    status?: string
  } | string
  message?: string
}
