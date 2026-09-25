/** Keyless fixture: the first read adds required instructions after pre-step compaction. */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-loop'

/** Run against the Loader-owned services and return only deterministic outcome facts. */
export async function runContextAdmissionScenario(ctx: Context) {
  const outcomes: Array<{ kind: 'adapter-called'; request: number } | {
    kind: 'request-refused'
    request: number
    code: string
    beforeInference: boolean
  }> = []
  class LocalFixtureAdapter extends LlmAdapter {
    calls = 0
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return { provider, id: model, name: model, context: { contextWindow: 32768 }, defaultMaxTokens: 4096 }
    }
    override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.calls += 1
      outcomes.push({ kind: 'adapter-called', request: this.calls })
      if (this.calls !== 1) throw new Error('oversized request reached the fixture adapter')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('read-one'), name: 'read', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  const adapter = new LocalFixtureAdapter()
  ctx.llm.registerAdapter(['context-fixture'], adapter)
  const baseline = 'required baseline '.repeat(4000)
  const mandatoryInstructions = 'REQUIRED INSTRUCTION\n'.repeat(2400).slice(0, 46688)
  ctx.systemPrompt.section({ name: 'baseline', order: 0, text: baseline })
  ctx.tools.register(defineContentToolFixture({
    name: 'read', description: 'Read the assigned source.', parameters: {},
    async execute(_args, execution) {
      if (execution.agent === undefined) throw new Error('expected a live fixture agent')
      execution.agent.inject(createUserMessage({
        content: [{ type: 'text', text: mandatoryInstructions }],
        source: { kind: 'plugin', plugin: 'mandatory-workspace-instructions' },
      }))
      return [{ type: 'text', text: 'source contents' }]
    },
  }))
  const agent = ctx.agentLoop.create(SessionId('context-admission'), { provider: 'context-fixture', model: 'worker' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Review this file.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const final = agent.session.events.at(-1)
  if (final?.type !== 'turn/end' || final.data.reason.kind !== 'error') throw new Error('expected a refused turn')
  outcomes.push({
    kind: 'request-refused', request: 2, code: final.data.reason.error.code,
    beforeInference: final.data.reason.error.message.startsWith('Request refused before inference:'),
  })
  const stored = agent.session.deriveMessages()
  const replayed = Session.create(agent.session.id, agent.session.events, agent.session.header)
  const header = replayed.requestHeader()
  if (header === undefined) throw new Error('expected the refused request header')
  const replayChunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({
    ...header.config,
    ...header.system === undefined ? {} : { system: header.system },
    ...header.tools === undefined ? {} : { tools: header.tools },
    messages: replayed.deriveMessages(),
  })) replayChunks.push(chunk)
  return {
    outcomes,
    adapterCalls: adapter.calls,
    readResults: agent.session.events.filter(event => event.type === 'tool/result').length,
    compactions: agent.session.events.filter(event => event.type === 'compaction/start').length,
    requiredInstructions: {
      characters: mandatoryInstructions.length,
      preserved: stored.some(message => message.content.some(block =>
        block.type === 'text' && block.text === mandatoryInstructions)),
      baselinePreserved: header.system?.includes(baseline) === true,
      replayUnchanged: JSON.stringify(replayed.deriveMessages()) === JSON.stringify(stored),
    },
    replay: replayChunks.map((chunk) => {
      if (chunk.type !== 'finish' || chunk.reason.kind !== 'error') throw new Error('expected replay refusal')
      return { kind: 'request-refused', code: chunk.reason.failure.code }
    }),
  }
}
