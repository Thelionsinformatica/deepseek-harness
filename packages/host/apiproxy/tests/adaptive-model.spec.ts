import { describe, expect, it } from 'vitest'
import {
  chooseAdaptiveFailover,
  chooseAdaptiveModel,
  type AdaptiveFailoverConfig,
  type AdaptiveRoutingConfig,
} from '../src/adaptive-model.ts'
import {
  evaluateAdaptiveRoutingShadow,
  validateAdaptiveRoutingShadowConfig,
  type AdaptiveRoutingShadowConfig,
  type AdaptiveShadowCandidateFacts,
  type AdaptiveShadowRequestFacts,
} from '../src/adaptive-routing-shadow.ts'
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
      residency: 'external',
      failureCodes: ['TRANSPORT', 'TIMEOUT', 'SERVER', 'UNKNOWN_MODEL', 'NO_ADAPTER'],
    },
    {
      fromProviders: ['omniroute'],
      provider: 'google',
      model: 'gemini-3.1-pro-preview-customtools',
      residency: 'external',
      failureCodes: [
        'TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT', 'QUOTA', 'EMPTY_RESPONSE',
        'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'UNKNOWN_MODEL',
      ],
    },
    {
      fromProviders: ['google'],
      provider: 'openai',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      residency: 'external',
      failureCodes: [
        'TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT', 'QUOTA', 'EMPTY_RESPONSE',
        'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'UNKNOWN_MODEL',
      ],
    },
  ],
}

const shadowConfig: AdaptiveRoutingShadowConfig = {
  policyVersion: 'test-shadow-v1',
  externalPolicy: 'fallback-only',
  routes: [
    {
      provider: 'ollama', model: 'qwen', residency: 'local', quality: 1, priority: 10,
      inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    },
    {
      provider: 'ollama', model: 'ornith', residency: 'local', quality: 2, priority: 20,
      inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    },
    { provider: 'omniroute', model: 'auto', residency: 'external', quality: 3, priority: 30 },
    {
      provider: 'google', model: 'gemini', residency: 'external', quality: 3, priority: 40,
      inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75,
    },
  ],
}

const healthy = { status: 'healthy' as const, samples: 10, consecutiveProviderFailures: 0 }

function candidate(
  provider: string,
  model: string,
  extra: Partial<AdaptiveShadowCandidateFacts> = {},
): AdaptiveShadowCandidateFacts {
  const configured = shadowConfig.routes.find(route => route.provider === provider && route.model === model)
  if (configured === undefined) throw new Error(`missing candidate ${provider}/${model}`)
  return {
    ...configured,
    available: true,
    contextWindow: configured.residency === 'local' ? 32768 : 262144,
    maxOutputTokens: configured.residency === 'local' ? 8192 : 32768,
    inputModalities: ['text', 'image'],
    health: healthy,
    ...extra,
  }
}

function requestFacts(extra: Partial<AdaptiveShadowRequestFacts> = {}): AdaptiveShadowRequestFacts {
  return {
    estimatedInputTokens: 4000,
    reservedOutputTokens: 4096,
    toolLoopReserveTokens: 0,
    projectedTokens: 8096,
    messageCount: 2,
    toolCount: 0,
    imageCount: 0,
    minimumQuality: 1,
    ...extra,
  }
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
    {
      content: [{
        type: 'text' as const,
        text: 'Faça uma análise profunda, em no máximo cinco linhas, sobre por que um assistente local deve usar fallback de API.',
      }],
    },
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
      residency: 'external',
      tier: 'failover',
    })
  })

  it('bypasses a failed OmniRoute through Gemini, then a failed Gemini through OpenAI', () => {
    expect(chooseAdaptiveFailover(config, { provider: 'omniroute', failureCode: 'RATE_LIMIT' })).toEqual({
      provider: 'google', model: 'gemini-3.1-pro-preview-customtools', residency: 'external', tier: 'failover',
    })
    expect(chooseAdaptiveFailover(config, { provider: 'google', failureCode: 'SERVER' })).toEqual({
      provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'low', residency: 'external', tier: 'failover',
    })
  })

  it('rejects an external residency failover when the request has an image', () => {
    const withResidency = {
      ...config,
      failovers: [
        {
          fromProviders: ['ollama'],
          provider: 'omniroute',
          model: 'auto',
          residency: 'external' as const,
          failureCodes: ['TRANSPORT'],
        },
      ],
    }
    expect(chooseAdaptiveFailover(withResidency, {
      provider: 'ollama', failureCode: 'TRANSPORT', hasImage: true,
    })).toBeUndefined()
    expect(chooseAdaptiveFailover(withResidency, {
      provider: 'ollama', failureCode: 'TRANSPORT', hasImage: false,
    })).toEqual({
      provider: 'omniroute', model: 'auto', residency: 'external', tier: 'failover',
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
        residency: 'external',
        failureCodes: ['TRANSPORT'],
      }],
    }, { provider: 'ollama', failureCode: 'TRANSPORT' })).toEqual({
      provider: 'google', model: 'gemini-pro', reasoningEffort: 'high', residency: 'external', tier: 'failover',
    })
    expect(chooseAdaptiveFailover({
      ...config,
      failovers: [{
        fromProviders: ['ollama'], provider: 'ollama', model: 'other', residency: 'local', failureCodes: ['TRANSPORT'],
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
    const { residency: _residency, ...unclassifiedFailover } = failover
    expect(() => ApiProxyService.Config({
      adaptiveRouting: {
        ...config,
        // Deliberately bypass the compile-time contract to exercise the runtime schema.
        failovers: [unclassifiedFailover as AdaptiveFailoverConfig],
      },
    })).toThrow()
  })
})

describe('adaptive routing shadow preflight', () => {
  it('recommends the cheapest capable local route and keeps external routes as fallback only', () => {
    const decision = evaluateAdaptiveRoutingShadow(shadowConfig, requestFacts(), [
      candidate('ollama', 'qwen'),
      candidate('ollama', 'ornith'),
      candidate('omniroute', 'auto'),
      candidate('google', 'gemini'),
    ])

    expect(decision.recommendation).toEqual({
      kind: 'route', provider: 'ollama', model: 'qwen', projectedCostUsd: 0,
    })
    expect(decision.candidates.find(route => route.provider === 'omniroute')?.reasons)
      .toContain('local-capable')
  })

  it('detects projected context overflow before dispatch and recommends the configured external gateway', () => {
    const request = requestFacts({
      estimatedInputTokens: 23702,
      reservedOutputTokens: 8192,
      toolLoopReserveTokens: 4096,
      projectedTokens: 35990,
      messageCount: 39,
      toolCount: 8,
      minimumQuality: 3,
    })
    const decision = evaluateAdaptiveRoutingShadow(shadowConfig, request, [
      candidate('ollama', 'qwen'),
      candidate('ollama', 'ornith'),
      candidate('omniroute', 'auto'),
      candidate('google', 'gemini'),
    ])

    expect(decision.recommendation).toEqual({ kind: 'route', provider: 'omniroute', model: 'auto' })
    expect(decision.candidates.find(route => route.model === 'qwen')?.reasons)
      .toEqual(expect.arrayContaining(['context-capacity', 'quality-below-required']))
  })

  it('treats a same-session capacity failure separately from provider health', () => {
    const qwen = candidate('ollama', 'qwen', {
      recentCapacityFailure: 'CONTEXT_WINDOW_EXCEEDED',
      health: { status: 'healthy', samples: 12, consecutiveProviderFailures: 0 },
    })
    const decision = evaluateAdaptiveRoutingShadow(shadowConfig, requestFacts(), [
      qwen,
      candidate('ollama', 'ornith'),
      candidate('omniroute', 'auto'),
    ])

    expect(decision.recommendation).toMatchObject({ kind: 'route', provider: 'ollama', model: 'ornith' })
    expect(decision.candidates.find(route => route.model === 'qwen')).toMatchObject({
      health: { status: 'healthy', consecutiveProviderFailures: 0 },
      reasons: ['recent-capacity-failure'],
    })
  })

  it('fails closed when external routes are denied and no local route is capable', () => {
    const decision = evaluateAdaptiveRoutingShadow(
      { ...shadowConfig, externalPolicy: 'deny' },
      requestFacts({ minimumQuality: 3 }),
      [
        candidate('ollama', 'qwen'),
        candidate('ollama', 'ornith'),
        candidate('omniroute', 'auto'),
      ],
    )

    expect(decision.recommendation).toEqual({ kind: 'blocked', reason: 'no-capable-route' })
    expect(decision.candidates.find(route => route.provider === 'omniroute')?.reasons)
      .toContain('external-denied')
  })

  it('projects price only from numeric metadata and persists no prompt field', () => {
    const request = requestFacts({
      estimatedInputTokens: 100000,
      reservedOutputTokens: 10000,
      projectedTokens: 110000,
      minimumQuality: 3,
    })
    const decision = evaluateAdaptiveRoutingShadow(
      { ...shadowConfig, externalPolicy: 'allow' },
      request,
      [candidate('google', 'gemini')],
    )

    expect(decision.recommendation).toEqual({
      kind: 'route', provider: 'google', model: 'gemini', projectedCostUsd: 0.1125,
    })
    expect(Object.keys(request)).not.toContain('prompt')
    expect(Object.keys(request)).not.toContain('content')
  })

  it('rejects duplicate routes and accepts the deployed policy through the service schema', () => {
    expect(() => {
      validateAdaptiveRoutingShadowConfig({
        ...shadowConfig,
        routes: [shadowConfig.routes[0]!, shadowConfig.routes[0]!],
      })
    }).toThrow(/repeats route/)
    expect(ApiProxyService.Config({
      adaptiveRouting: { ...config, shadow: shadowConfig },
    }).adaptiveRouting?.shadow).toMatchObject({
      policyVersion: 'test-shadow-v1',
      externalPolicy: 'fallback-only',
      outputReserveTokens: 8192,
    })
  })
})
