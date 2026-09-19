import { describe, expect, it } from 'vitest'
import { chooseAdaptiveModel, type AdaptiveRoutingConfig } from '../src/adaptive-model.ts'

const config: AdaptiveRoutingConfig = {
  provider: 'local', fastModel: 'small', mainModel: 'main', expertModel: 'expert',
  expertBySize: false,
  visionRoute: { provider: 'vision', model: 'visual' },
  specialtyRoutes: [{ id: 'code', markers: ['code'], model: 'text-only' }],
  goalRoundTiers: [{ fromRound: 3, provider: 'local', model: 'text-only' }],
}

describe('capability-aware admission', () => {
  it('retains vision on a text-only continuation with image history', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'continue' }],
      hasHistory: true, hasImageHistory: true, goalRound: 6,
    })).toMatchObject({ provider: 'vision', model: 'visual' })
  })
  it.each([{}, { goalRound: 6 }, { recovery: 'completion-evidence' as const }])(
    'keeps image routing ahead of text-only policies %j', (extra) => {
      expect(chooseAdaptiveModel(config, {
        content: [{ type: 'text', text: 'code' }, { type: 'image', data: 'AA==', mediaType: 'image/png' }],
        hasHistory: true, ...extra,
      })).toMatchObject({ provider: 'vision', model: 'visual' })
    },
  )
  it('does not interpret length alone as expert difficulty', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'texto '.repeat(200) }], hasHistory: false,
    }).tier).toBe('main')
  })
  it('still recognizes explicit complex work', () => {
    expect(chooseAdaptiveModel(config, {
      content: [{ type: 'text', text: 'auditoria completa' }], hasHistory: false,
    }).tier).toBe('expert')
  })
})
