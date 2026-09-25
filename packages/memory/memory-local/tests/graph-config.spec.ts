import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, resolveSemanticConfig, validateMemoryGraphLinkingConfig } from '../src/index.ts'

describe('graph configuration boundary', () => {
  it.each([
    { minScore: NaN }, { minScore: Infinity }, { minScore: 1.01 }, { minScore: -1.01 },
    { maxGraphNodes: 0 }, { maxGraphNodes: 1.5 }, { maxEdgesPerNode: -1 },
    { maxExpandedHits: -1 }, { maxExpandedHits: NaN }, { debounceMs: -1 },
    { debounceMs: 2_147_483_648 },
  ])('rejects invalid graph policy %j before opening storage', async (linking) => {
    expect(() => { validateMemoryGraphLinkingConfig(linking) }).toThrow(TypeError)
    const ctx = new Context()
    await expect(apply(ctx, { linking })).rejects.toThrow('memory-local: linking.')
    await ctx.fiber.dispose()
  })

  it('accepts zero expansion and debounce, and signed cosine bounds', () => {
    expect(() => { validateMemoryGraphLinkingConfig({ minScore: -1, maxExpandedHits: 0, debounceMs: 0 }) }).not.toThrow()
  })

  it.each([
    { dimensions: 0 }, { timeoutMs: Infinity }, { maxCacheEntries: -1 },
    { maxResponseBytes: 0 }, { model: ' ' }, { baseUrl: 'http://example.com' },
  ])('rejects invalid shared embedding bounds %j', (config) => {
    expect(() => resolveSemanticConfig(config)).toThrow(TypeError)
  })

  it('rejects enabled linking without embeddings before opening storage', async () => {
    const ctx = new Context()
    await expect(apply(ctx, { linking: { enabled: true } })).rejects.toThrow('requires semanticSearch.enabled')
    await ctx.fiber.dispose()
  })
})
