import { describe, expect, it } from 'vitest'
import { chooseAdaptiveFailover, chooseAdaptiveModel, type AdaptiveRoutingConfig } from '../src/adaptive-model.ts'
import ApiProxyService from '../src/index.ts'

const config: AdaptiveRoutingConfig = {
  provider: 'ollama',
  fastProvider: 'ollama',
  mainProvider: 'ollama',
  expertProvider: 'ollama',
  fastModel: 'qwen3.5:9b',
  mainModel: 'qwen3.5:9b',
  expertModel: 'ornith-1.5:9b',
  fastReasoningEffort: 'off',
  mainReasoningEffort: 'medium',
  expertReasoningEffort: 'high',
  simpleMaxCharacters: 120,
  expertMinCharacters: 500,
  goalRoundTiers: [
    { fromRound: 1, provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high' },
  ],
  failovers: [
    {
      fromProviders: ['ollama'],
      provider: 'omniroute',
      model: 'auto',
      failureCodes: ['TRANSPORT', 'TIMEOUT', 'SERVER', 'UNKNOWN_MODEL', 'NO_ADAPTER'],
    },
    {
      fromProviders: ['omniroute'],
      provider: 'google',
      model: 'gemini-3.6-flash',
      failureCodes: [
        'TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT', 'QUOTA', 'EMPTY_RESPONSE',
        'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'UNKNOWN_MODEL',
      ],
    },
    {
      fromProviders: ['google'],
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      failureCodes: [
        'TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT', 'QUOTA', 'EMPTY_RESPONSE',
        'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'UNKNOWN_MODEL',
      ],
    },
  ],
}

describe('chooseAdaptiveModel()', () => {
  it('uses the fast local tier for short self-contained conversation', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'Qual é a capital do Ceará?' }],
      hasHistory: false,
    })).toEqual({ provider: 'ollama', model: 'qwen3.5:9b', reasoningEffort: 'off', tier: 'fast' })
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'Teste local: responda apenas LEON OK.' }],
      hasHistory: false,
    })).toEqual({ provider: 'ollama', model: 'qwen3.5:9b', reasoningEffort: 'off', tier: 'fast' })
  })

  it.each([
    { content: [{ type: 'text' as const, text: 'Crie testes unitários para esta regra.' }] },
    { content: [{ type: 'text' as const, text: '```ts\nfunction leon() {\n  return true\n}\n```' }] },
    { content: [{ type: 'text' as const, text: 'x'.repeat(121) }] },
  ])('uses the stronger local main tier for medium technical work', ({ content }) => {
    expect(chooseAdaptiveModel(config, { content, hasHistory: false }))
      .toEqual({ provider: 'ollama', model: 'qwen3.5:9b', reasoningEffort: 'medium', tier: 'main' })
  })

  it.each([
    { content: [{ type: 'text' as const, text: 'Faça uma auditoria completa deste projeto.' }] },
    { content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' }] },
  ])('uses the local specialist tier for complex or multimodal work', ({ content }) => {
    expect(chooseAdaptiveModel(config, { content, hasHistory: false }))
      .toEqual({ provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high', tier: 'expert' })
  })

  it('treats a terse continuation as contextual only when history exists', () => {
    const content = [{ type: 'text' as const, text: 'continue' }]
    expect(chooseAdaptiveModel(config, { content, hasHistory: false }).tier).toBe('fast')
    expect(chooseAdaptiveModel(config, { content, hasHistory: true }).tier).toBe('main')
  })

  it('promotes large structured first requests to the configured expert route', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: `Implemente este projeto completo.\n${'requisito\n'.repeat(20)}` }],
      hasHistory: false,
    })).toEqual({ provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high', tier: 'expert' })
  })

  it('uses the highest eligible explicit goal-round tier', () => {
    expect(chooseAdaptiveModel(config, { content: [], hasHistory: true, goalRound: 1 }))
      .toEqual({ provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high', tier: 'goal-round' })
    expect(chooseAdaptiveModel(config, { content: [], hasHistory: true, goalRound: 4 }))
      .toEqual({ provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high', tier: 'goal-round' })
  })

  it('selects only the explicitly configured expert provider for complex wording', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'Analise toda a arquitetura e resolva os problemas.' }],
      hasHistory: true,
    })).toEqual({ provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high', tier: 'expert' })
  })

  it('preserves provider defaults when tier efforts are not configured', () => {
    expect(chooseAdaptiveModel({
      provider: 'ollama',
      fastModel: 'fast',
      mainModel: 'main',
    }, {
      content: [{ type: 'text', text: 'Olá' }],
      hasHistory: false,
    })).toEqual({ provider: 'ollama', model: 'fast', tier: 'fast' })
  })
})

describe('chooseAdaptiveFailover()', () => {
  it.each(['TRANSPORT', 'TIMEOUT', 'SERVER'])('sends an unavailable local route through OmniRoute for %s', (failureCode) => {
    expect(chooseAdaptiveFailover(config, { provider: 'ollama', failureCode })).toEqual({
      provider: 'omniroute',
      model: 'auto',
      tier: 'failover',
    })
  })

  it('bypasses a failed OmniRoute through Gemini, then a failed Gemini through OpenAI', () => {
    expect(chooseAdaptiveFailover(config, { provider: 'omniroute', failureCode: 'RATE_LIMIT' })).toEqual({
      provider: 'google', model: 'gemini-3.6-flash', tier: 'failover',
    })
    expect(chooseAdaptiveFailover(config, { provider: 'google', failureCode: 'SERVER' })).toEqual({
      provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high', tier: 'failover',
    })
  })

  it('does not replace an ineligible failure or the final provider', () => {
    expect(chooseAdaptiveFailover(config, { provider: 'ollama', failureCode: 'AUTH' })).toBeUndefined()
    expect(chooseAdaptiveFailover(config, { provider: 'openai', failureCode: 'TRANSPORT' })).toBeUndefined()
    const { failovers: _failovers, ...configWithoutFailover } = config
    expect(chooseAdaptiveFailover(configWithoutFailover, {
      provider: 'ollama', failureCode: 'TRANSPORT',
    })).toBeUndefined()
  })

  it('preserves the configured replacement effort and rejects a same-provider loop', () => {
    expect(chooseAdaptiveFailover({
      ...config,
      failovers: [{
        fromProviders: ['ollama'],
        provider: 'google',
        model: 'gemini-pro',
        reasoningEffort: 'high',
        failureCodes: ['TRANSPORT'],
      }],
    }, { provider: 'ollama', failureCode: 'TRANSPORT' })).toEqual({
      provider: 'google', model: 'gemini-pro', reasoningEffort: 'high', tier: 'failover',
    })
    expect(chooseAdaptiveFailover({
      ...config,
      failovers: [{
        fromProviders: ['ollama'], provider: 'ollama', model: 'other', failureCodes: ['TRANSPORT'],
      }],
    }, { provider: 'ollama', failureCode: 'TRANSPORT' })).toBeUndefined()
  })
})

describe('adaptive routing configuration', () => {
  it('accepts an ordered failover chain and rejects empty eligibility lists', () => {
    const [failover] = config.failovers ?? []
    if (failover === undefined) throw new Error('test configuration requires failovers')
    expect(ApiProxyService.Config({ adaptiveRouting: config }).adaptiveRouting?.failovers).toEqual(config.failovers)
    expect(() => ApiProxyService.Config({
      adaptiveRouting: {
        ...config,
        failovers: [{ ...failover, fromProviders: [] }],
      },
    })).toThrow()
    expect(() => ApiProxyService.Config({
      adaptiveRouting: {
        ...config,
        failovers: [{ ...failover, failureCodes: [] }],
      },
    })).toThrow()
  })
})
