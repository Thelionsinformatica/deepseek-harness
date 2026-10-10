/**
 * Pure wire and projection types for the session-scoped web-access capability.
 * @module @deepseek-ai/dsh-web-access/types
 */

/**
 * The client-visible access grant for native public web tools in one session.
 * The key is absent when the web-access controller is not composed.
 */
export interface WebAccessProjection {
  /** Whether this session may use the native public web tools without a per-call approval. */
  readonly enabled: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Durable state folded from the latest complete `web/access` event. */
    webAccess: WebAccessProjection
  }

  interface SessionProjectionMap {
    /** Current explicit user grant for native public web search and fetch tools. */
    webAccess: WebAccessProjection
  }
}
