import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  GOOGLE_SEARCH_PROVIDER_ID,
  GoogleSearchProvider,
  mapGoogleInteraction,
} from '@deepseek-ai/dsh-web-search-google'
import * as googlePlugin from '@deepseek-ai/dsh-web-search-google'
import type { GoogleSearchProviderOptions } from '@deepseek-ai/dsh-web-search-google'
import type { GoogleInteractionResponse } from '@deepseek-ai/dsh-web-search-google/src/types.ts'

/** Construct the provider over a fixed options value; production passes a live thunk. */
const searchProvider = (options: GoogleSearchProviderOptions): GoogleSearchProvider =>
  new GoogleSearchProvider(() => options)

const options: GoogleSearchProviderOptions = {
  apiKey: 'google-key',
  baseURL: 'https://generativelanguage.test/v1beta',
  model: 'gemini-test',
}

const keylessOptions = (
  resolveApiKey: () => Promise<string | undefined>,
): GoogleSearchProviderOptions => ({
  baseURL: options.baseURL,
  model: options.model,
  resolveApiKey,
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function groundedResponse(): GoogleInteractionResponse {
  return {
    status: 'completed',
    steps: [{
      type: 'model_output',
      content: [{
        type: 'text',
        text: 'Leon encontrou uma fonte atual.',
        annotations: [{
          type: 'url_citation',
          url: 'https://example.test/current',
          title: 'Example',
          start_index: 0,
          end_index: 31,
        }],
      }],
    }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapGoogleInteraction', () => {
  it('maps grounded text and URL annotations', () => {
    expect(mapGoogleInteraction(groundedResponse())).toEqual({
      content: 'Leon encontrou uma fonte atual.',
      sources: [{
        url: 'https://example.test/current',
        title: 'Example',
        snippet: 'Leon encontrou uma fonte atual.',
      }],
      truncated: false,
    })
  })

  it('deduplicates URLs and preserves the first citation metadata', () => {
    const result = mapGoogleInteraction({
      steps: [{
        type: 'model_output',
        content: [{
          type: 'text',
          text: 'First. Second.',
          annotations: [
            { type: 'url_citation', url: 'https://a.test', title: 'First', start_index: 0, end_index: 6 },
            { type: 'url_citation', url: 'https://a.test', title: 'Second', start_index: 7, end_index: 14 },
            { type: 'url_citation', url: 'https://b.test' },
          ],
        }],
      }],
    })
    expect(result.sources).toEqual([
      { url: 'https://a.test', title: 'First', snippet: 'First.' },
      { url: 'https://b.test' },
    ])
  })

  it('joins text from multiple model-output blocks', () => {
    expect(mapGoogleInteraction({
      steps: [
        { type: 'model_output', content: [{ type: 'text', text: 'Primeiro' }] },
        { type: 'google_search_call', arguments: { queries: ['q'] } },
        { type: 'model_output', content: [{ type: 'text', text: 'Segundo' }] },
      ],
    }).content).toBe('Primeiro\n\nSegundo')
  })

  it('rejects a response with no model text', () => {
    expect(() => mapGoogleInteraction({ steps: [{ type: 'google_search_call' }] }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('GoogleSearchProvider', () => {
  it('reports availability from credential, endpoint, and model configuration', () => {
    expect(searchProvider(options).available()).toBe(true)
    expect(searchProvider({ ...options, apiKey: '' }).available()).toBe(false)
    expect(searchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
    expect(searchProvider({ ...options, model: ' ' }).available()).toBe(false)
    expect(searchProvider(keylessOptions(async () => 'later')).available()).toBe(true)
  })

  it('posts a stateless Interactions request with Google Search enabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(groundedResponse()))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchProvider({ ...options, recordRequest }).search({ query: 'notícias de IA', maxResults: 4 })

    expect(result.sources).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.test/v1beta/interactions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'google-key' })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gemini-test',
      tools: [{ type: 'google_search' }],
      store: false,
    })
    expect(body.input).toContain('notícias de IA')
    expect(body.input).toContain('at most 4 sources')
    expect(recordRequest).toHaveBeenCalledWith({
      endpoint: url,
      body,
    })
    expect(JSON.stringify(recordRequest.mock.calls)).not.toContain('google-key')
  })

  it('resolves the credential for each operation', async () => {
    const requestInits: RequestInit[] = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init !== undefined) requestInits.push(init)
      return jsonResponse(groundedResponse())
    })
    const resolveApiKey = vi.fn()
      .mockResolvedValueOnce('first-key')
      .mockResolvedValueOnce('second-key')
    vi.stubGlobal('fetch', fetchMock)
    const provider = searchProvider(keylessOptions(resolveApiKey))

    await provider.search({ query: 'one' })
    await provider.search({ query: 'two' })

    expect(resolveApiKey).toHaveBeenCalledTimes(2)
    expect(requestInits[0]?.headers).toMatchObject({ 'x-goog-api-key': 'first-key' })
    expect(requestInits[1]?.headers).toMatchObject({ 'x-goog-api-key': 'second-key' })
  })

  it('fails with an actionable code when the referenced credential is missing', async () => {
    const provider = searchProvider(keylessOptions(async () => undefined))
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
    })
  })

  it('preserves provider error messages without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: { message: 'model is unavailable' },
    }, { status: 404 })))
    await expect(searchProvider(options).search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'model is unavailable',
    })
  })
})

describe('web-search-google plugin registration', () => {
  it('registers the provider in the real web seam', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime)
    await ctx.plugin(googlePlugin, { apiKey: 'key', model: 'gemini-test' })
    const fetchMock = vi.fn(async () => jsonResponse(groundedResponse()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ctx.web.search({ query: 'q', maxResults: 1 })

    expect(result.sources).toHaveLength(1)
    expect(GOOGLE_SEARCH_PROVIDER_ID).toBe('google-grounding')
    await ctx.fiber.dispose()
  })
})
