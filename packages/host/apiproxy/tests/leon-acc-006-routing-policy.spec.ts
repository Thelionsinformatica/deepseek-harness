import { describe, expect, it } from 'vitest'
import { chooseAdaptiveModel, type AdaptiveRoutingDecision } from '../src/adaptive-model.ts'
import {
  dispatchThroughLeonAcc006Sentinel,
  leonAcc006RoutingConfig,
  leonAcc006RoutingTasks,
  type LeonAcc006RoutingTask,
} from './leon-acc-006-routing-policy.fixture.ts'

describe('LEON-ACC-006 — política inicial local, sem provar qualidade ou conclusão das tarefas', () => {
  it('classifica 30 tarefas PT-BR e mantém toda seleção inicial em Ollama/Qwen ou Ollama/Ornith', () => {
    expect(leonAcc006RoutingTasks).toHaveLength(30)
    expect(new Set(leonAcc006RoutingTasks.map(task => task.id)).size).toBe(30)

    const decisions = leonAcc006RoutingTasks.map((task: LeonAcc006RoutingTask) => {
      const decision = chooseAdaptiveModel(leonAcc006RoutingConfig, {
        content: task.content,
        hasHistory: task.hasHistory,
        ...task.goalRound === undefined ? {} : { goalRound: task.goalRound },
      })

      expect(decision, task.id).toMatchObject({
        provider: 'ollama',
        model: task.expectedModel,
        tier: task.expectedTier,
      })
      return dispatchThroughLeonAcc006Sentinel(decision)
    })

    expect(decisions).toHaveLength(30)
    expect(new Set(decisions.map(decision => decision.provider))).toEqual(new Set(['ollama']))
    expect(decisions.filter(decision => decision.model === 'qwen3.5:9b')).toHaveLength(22)
    expect(decisions.filter(decision => decision.model === 'ornith-1.5:9b')).toHaveLength(8)
  })

  it('prova que a sentinela offline reprova uma rota externa antes de qualquer adaptador', () => {
    const externalDecision: AdaptiveRoutingDecision = {
      provider: 'google',
      model: 'gemini-3.1-pro-preview-customtools',
      tier: 'failover',
    }

    expect(() => dispatchThroughLeonAcc006Sentinel(externalDecision))
      .toThrow('LEON-ACC-006_EXTERNAL_ROUTE_BLOCKED: google/gemini-3.1-pro-preview-customtools')
  })
})
