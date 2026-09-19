/**
 * HTTP transport pinned to prevalidated addresses. Undici receives a fresh
 * dispatcher for each request hop, so it cannot reuse a socket or repeat DNS
 * resolution outside the destination policy.
 * @module @deepseek-ai/dsh-web-fetch-http/transport
 */

import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import type { PublicAddress } from './network-policy.ts'
import { isPublicIpAddress } from './network-policy.ts'

/** A response plus ownership of the request-scoped dispatcher. */
export interface ResponseLease {
  readonly response: Response
  release(): Promise<void>
}

/** Options shared by production transport and deterministic test transports. */
export interface PinnedRequestOptions {
  readonly headers: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

/** Request dependency injected into the provider's network boundary. */
export type PinnedRequester = (
  url: URL,
  addresses: readonly PublicAddress[],
  options: PinnedRequestOptions,
) => Promise<ResponseLease>

/** Minimal dispatcher ownership required by the request-scoped transport. */
export interface ClosableDispatcher {
  close(): Promise<void>
}

/** Injectable Undici operations used to cover success and failure without live internet. */
export interface TransportRuntime {
  createDispatcher(addresses: readonly PublicAddress[]): ClosableDispatcher
  fetch(url: URL, options: PinnedRequestOptions, dispatcher: ClosableDispatcher): Promise<Response>
}

const PRODUCTION_RUNTIME: TransportRuntime = {
  /* v8 ignore next 5 -- Undici construction glue; policy/lifecycle use injected keyless tests. */
  createDispatcher: addresses => new Agent({
    connections: 1,
    pipelining: 0,
    connect: { lookup: pinnedLookup(addresses) },
  }),
  /* v8 ignore next 8 -- live public HTTP is absent from keyless tests; injected tests pin options. */
  fetch: async (url, options, dispatcher) => await undiciFetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: options.headers,
    signal: options.signal,
    dispatcher: dispatcher as Agent,
  }) as Response,
}

/**
 * Fetch one URL using only the addresses approved for this hop. Every address
 * is rechecked at this operation boundary, then supplied through Undici's
 * connector lookup so the original hostname remains available for Host and TLS
 * verification while the socket destination cannot change.
 *
 * @param runtime - Dispatcher and fetch operations; production defaults to Undici.
 * @returns A requester that owns and closes one dispatcher per request hop.
 */
export function createPinnedRequester(runtime: TransportRuntime = PRODUCTION_RUNTIME): PinnedRequester {
  return async (url, addresses, options) => {
    if (addresses.length === 0) throw new Error('requestPinned requires at least one approved address')
    for (const address of addresses) {
      if (isIP(address.address) !== address.family || !isPublicIpAddress(address.address)) {
        throw new Error('requestPinned received an invalid or non-public address')
      }
    }

    const dispatcher = runtime.createDispatcher(addresses)
    try {
      const response = await runtime.fetch(url, options, dispatcher)
      return {
        response,
        release: async () => { await dispatcher.close() },
      }
    } catch (error: unknown) {
      await dispatcher.close()
      throw error
    }
  }
}

/** Production requester backed by a fresh pinned Undici dispatcher per hop. */
export const requestPinned = createPinnedRequester()

/**
 * Build a synchronous lookup that can return only the prevalidated answer set.
 *
 * @param addresses - Public addresses approved for one request hop.
 * @returns A Node lookup function with no access to DNS.
 */
export function pinnedLookup(addresses: readonly PublicAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family
    const eligible = requestedFamily === 4 || requestedFamily === 6
      ? addresses.filter(address => address.family === requestedFamily)
      : addresses
    const selected = eligible[0]
    if (selected === undefined) {
      const error = new Error('no approved address matches the requested family') as NodeJS.ErrnoException
      error.code = 'EAI_ADDRFAMILY'
      callback(error, '')
      return
    }
    if (options.all === true) {
      callback(null, eligible.map(address => ({ address: address.address, family: address.family })))
      return
    }
    callback(null, selected.address, selected.family)
  }
}
