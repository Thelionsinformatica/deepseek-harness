import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { resolveConfig } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import LlmRuntime, { createMessage, createSystemMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'

const SIGNAL = new AbortController().signal
const MODEL = 'test-model'
const TEXT = 'fixture words for context '

class ContextAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createContext(contextWindow = 1_000): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  // The registry is a required injection of TokenMeter (its projection units register in the constructor).
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL], new ContextAdapter(contextWindow))
  return ctx
}

/** Append one closed two-message turn. */
function appendTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `${TEXT}user ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  if (turn === 1) {
    session.append('request/header', { header: { config: { provider: MODEL, model: MODEL } }, reason: 'initial' })
  }
  session.append('assistant/message', {
    stream: [],
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `${TEXT}assistant ${turn}` }],
      source: { kind: 'model', ...{ provider: MODEL, model: MODEL } },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
}

/** Closed two-message turns; a system message can open the surface. */
function conversation(turns: number, system?: string): Session {
  const session = Session.create(SessionId(`incremental-${turns}-${system ?? 'no-system'}`))
  if (system !== undefined) {
    session.append('turn/start', { turn: 1 })
    session.append('system/message', { turn: 1, step: 1, message: createSystemMessage(system) }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${TEXT}user 1` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', { header: { config: { provider: MODEL, model: MODEL } }, reason: 'initial' })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `${TEXT}assistant 1` }],
        source: { kind: 'model', ...{ provider: MODEL, model: MODEL } },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    for (let turn = 2; turn <= turns; turn += 1) appendTurn(session, turn)
    return session
  }
  for (let turn = 1; turn <= turns; turn += 1) appendTurn(session, turn)
  return session
}

/** Append one retained checkpoint message to the surface. */
function appendCheckpoint(session: Session, id: string, text = 'checkpoint summary'): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: compactCheckpointSource(CompactionId(id)),
  }), { surfaceOp: 'append' })
}

/** Whether the surface node is a retained checkpoint message. */
function isCheckpointNode(session: Session, node: SessionSeq): boolean {
  const event = session.eventAt(node)
  return event?.type === 'user/message' && event.data.source.kind === 'compact-checkpoint'
}

function agent(session: Session): Agent {
  return { session, options: { provider: MODEL, model: MODEL } } as Agent
}

/** Engine whose summarizer is captured instead of calling a model. */
class CapturingEngine extends BasicCompactionEngine {
  readonly calls: SummarizationInput[] = []

  override async summarize(input: SummarizationInput): Promise<{
    summary: { type: 'text'; text: string }[]
    provider: string
    model: string
  }> {
    this.calls.push(input)
    return { summary: [{ type: 'text', text: 'folded summary' }], provider: MODEL, model: MODEL }
  }
}

describe('incremental folding strategy', () => {
  it('starts after the newest checkpoint instead of at the first surface message', () => {
    const ctx = createContext()
    const session = conversation(2, 'SYSTEM HEAD')
    appendCheckpoint(session, 'first')
    appendTurn(session, 3)
    appendTurn(session, 4)

    const measurement = ctx.tokenMeter.measure(session)
    const cumulative = selectCompactableRange(session, measurement, 1)
    const incremental = selectCompactableRange(session, measurement, 1, { strategy: 'incremental' })
    expect(cumulative?.start).toBe(session.surface.nodes[1])
    expect(incremental?.start).toBeDefined()
    expect(session.surface.nodes.indexOf(incremental!.start)).toBeGreaterThan(session.surface.nodes.indexOf(cumulative!.start))
    expect(incremental?.end).toBe(cumulative?.end)
  })

  it('behaves like cumulative before the first checkpoint', () => {
    const ctx = createContext()
    const session = conversation(2, 'SYSTEM HEAD')
    const measurement = ctx.tokenMeter.measure(session)
    expect(selectCompactableRange(session, measurement, 1, { strategy: 'incremental' }))
      .toEqual(selectCompactableRange(session, measurement, 1))
  })

  it('declines when nothing arrived after the newest checkpoint', () => {
    const ctx = createContext()
    const session = conversation(2, 'SYSTEM HEAD')
    appendCheckpoint(session, 'only')
    const measurement = ctx.tokenMeter.measure(session)
    expect(selectCompactableRange(session, measurement, 1, { strategy: 'incremental' })).toBeNull()
  })

  it('falls back to the cumulative span once the generation cap is reached', () => {
    const ctx = createContext()
    const session = conversation(2, 'SYSTEM HEAD')
    appendCheckpoint(session, 'one')
    appendCheckpoint(session, 'two')
    const measurement = ctx.tokenMeter.measure(session)
    expect(selectCompactableRange(session, measurement, 1, { strategy: 'incremental', maxGenerations: 2 }))
      .toEqual(selectCompactableRange(session, measurement, 1))
  })
})

describe('incremental folding configuration', () => {
  it('resolves the strategy and its generation cap', () => {
    expect(resolveConfig({ strategy: 'incremental', maxGenerations: 3 })).toMatchObject({
      strategy: 'incremental',
      maxGenerations: 3,
    })
  })

  it('rejects an unknown strategy, a bad cap, or a cap without incremental mode', () => {
    expect(() => resolveConfig({ strategy: 'rolling' as 'incremental' })).toThrow(/strategy/)
    expect(() => resolveConfig({ strategy: 'incremental', maxGenerations: 0 })).toThrow(/maxGenerations/)
    expect(() => resolveConfig({ strategy: 'incremental', maxGenerations: 1.5 })).toThrow(/maxGenerations/)
    expect(() => resolveConfig({ maxGenerations: 4 })).toThrow(/maxGenerations requires strategy/)
  })
})

describe('incremental folding through the engine', () => {
  const config: BasicCompactionConfig = {
    auto: false,
    thresholdRatio: 0.5,
    retainTokens: 60,
    strategy: 'incremental',
  }

  it('keeps the first checkpoint in place and folds only newer messages', async () => {
    const ctx = createContext(400)
    const engine = new CapturingEngine(ctx, { headroomTokens: 0, maxTokens: 512, ...config })
    const session = conversation(6)
    const first = await engine.compactIfNeeded(agent(session), 'context-overflow', SIGNAL)
    expect(first).not.toBeNull()
    const firstCheckpoint = session.surface.nodes.find(node => isCheckpointNode(session, node))
    expect(firstCheckpoint).toBeDefined()

    for (const turn of [7, 8, 9, 10, 11, 12]) appendTurn(session, turn)

    const second = await engine.compactIfNeeded(agent(session), 'context-overflow', SIGNAL)
    expect(second).not.toBeNull()
    expect(session.surface.nodes).toContain(firstCheckpoint)
    expect(engine.calls).toHaveLength(2)
    const secondInput = JSON.stringify(engine.calls[1]!.messages)
    expect(secondInput).toContain('user 7"')
    expect(secondInput).not.toContain('user 1"')
    expect(session.snapshotEvents().filter(event => event.type === 'compaction/start')).toHaveLength(2)
  })
})
