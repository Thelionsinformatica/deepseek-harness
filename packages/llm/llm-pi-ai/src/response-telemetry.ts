/**
 * Response-body telemetry that provider SDKs do not expose.
 *
 * OmniRoute cannot know the final charge when it opens an SSE response. For
 * streaming completions it therefore emits the usual `X-OmniRoute-*` values
 * as terminal SSE comment lines immediately before `[DONE]`. OpenAI's SDK
 * deliberately discards comments, so pi-ai's `onResponse` hook can see the
 * non-streaming headers but not the streaming charge.
 *
 * This module installs one process-wide, reference-counted fetch observer only
 * while an opted-in provider stream is alive. AsyncLocalStorage handles eager
 * clients, while an internal request header keeps lazy SDK requests isolated
 * after they leave that async scope. Every byte is forwarded unchanged;
 * complete OmniRoute comment lines are reported before the SDK receives the
 * chunk containing `[DONE]`, which lets the adapter attach the exact cost to
 * terminal usage.
 *
 * @module dsh-llm-pi-ai/response-telemetry
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/** Receives one normalized provider telemetry field. */
export type ResponseTelemetrySink = (headers: Readonly<Record<string, string>>) => void

interface TelemetryContext {
  sink: ResponseTelemetrySink
}

interface TelemetryFetchState {
  activeScopes: number
  delegate?: typeof globalThis.fetch
  nextScopeId: number
  sinks: Map<string, ResponseTelemetrySink>
  wrapper?: typeof globalThis.fetch
  storage: AsyncLocalStorage<TelemetryContext>
}

type TelemetryGlobal = typeof globalThis & {
  __dshPiAiResponseTelemetryFetch?: TelemetryFetchState
}

const TELEMETRY_HEADER = 'x-dsh-response-telemetry-id'

/** One shared observer even when the package is evaluated through two paths. */
function sharedState(): TelemetryFetchState {
  const host = globalThis as TelemetryGlobal
  return host.__dshPiAiResponseTelemetryFetch ??= {
    activeScopes: 0,
    nextScopeId: 0,
    sinks: new Map(),
    storage: new AsyncLocalStorage<TelemetryContext>(),
  }
}

/** Resolve the per-request sink even when a lazy SDK leaves the async scope. */
function sinkOf(
  state: TelemetryFetchState,
  input: Parameters<typeof globalThis.fetch>[0],
  init: Parameters<typeof globalThis.fetch>[1],
): ResponseTelemetrySink | undefined {
  const contextual = state.storage.getStore()?.sink
  if (contextual !== undefined) return contextual
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  const scopeId = headers.get(TELEMETRY_HEADER)
  return scopeId === null ? undefined : state.sinks.get(scopeId)
}

/** Report a complete OmniRoute SSE comment line, ignoring ordinary comments. */
function reportComment(line: string, sink: ResponseTelemetrySink): void {
  const match = /^:\s*(x-omniroute-[a-z0-9-]+)=(.*)$/i.exec(line.replace(/\r$/, ''))
  if (match === null) return
  const name = match[1]
  const value = match[2]
  if (name === undefined || value === undefined) return
  sink({ [name]: value.trim() })
}

/** Forward an SSE body unchanged while observing complete comment lines. */
function observeSse(response: Response, sink: ResponseTelemetrySink): Response {
  if (response.body === null) return response
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return response

  const decoder = new TextDecoder()
  let pending = ''
  const observer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) reportComment(line, sink)
      controller.enqueue(chunk)
    },
    flush() {
      pending += decoder.decode()
      if (pending.length > 0) reportComment(pending, sink)
    },
  })

  return new Response(response.body.pipeThrough(observer), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Install the shared wrapper for the first active telemetry scope. */
function retain(state: TelemetryFetchState): boolean {
  if (state.activeScopes > 0) {
    state.activeScopes += 1
    return true
  }
  const delegate = globalThis.fetch
  state.delegate = delegate
  state.wrapper = async (input, init) => {
    const response = await delegate(input, init)
    const sink = sinkOf(state, input, init)
    return sink === undefined ? response : observeSse(response, sink)
  }
  globalThis.fetch = state.wrapper
  state.activeScopes = 1
  return true
}

/** Restore the fetch function only after the last live scope finishes. */
function release(state: TelemetryFetchState): void {
  if (state.activeScopes === 0) return
  state.activeScopes -= 1
  if (state.activeScopes > 0) return
  if (state.wrapper !== undefined && globalThis.fetch === state.wrapper && state.delegate !== undefined) {
    globalThis.fetch = state.delegate
  }
  delete state.delegate
  delete state.wrapper
}

/**
 * Opt one provider stream into terminal SSE telemetry capture.
 *
 * `run` wraps creation of pi-ai's stream for eager clients. `headers` carries a
 * non-secret correlation id for clients that defer their fetch until the
 * iterable is consumed. `close` is idempotent and must run after the stream
 * settles or is cancelled.
 * @param enabled - whether response telemetry interception should be active.
 * @param sink - callback that receives the captured provider telemetry.
 * @returns correlation headers plus scoped stream creation and cleanup helpers.
 */
export function responseTelemetryScope(enabled: boolean, sink: ResponseTelemetrySink): {
  headers: Readonly<Record<string, string>>
  run: <T>(create: () => T) => T
  close: () => void
} {
  if (!enabled) return { headers: {}, run: create => create(), close: () => {} }
  const state = sharedState()
  const retained = retain(state)
  if (!retained) return { headers: {}, run: create => create(), close: () => {} }
  const scopeId = `${process.pid}-${++state.nextScopeId}`
  state.sinks.set(scopeId, sink)
  let closed = false
  return {
    headers: { [TELEMETRY_HEADER]: scopeId },
    run: create => state.storage.run({ sink }, create),
    close: () => {
      if (closed) return
      closed = true
      state.sinks.delete(scopeId)
      release(state)
    },
  }
}
