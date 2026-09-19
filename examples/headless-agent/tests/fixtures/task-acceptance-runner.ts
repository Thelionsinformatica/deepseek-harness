/** Loader composition: only model transport is deterministic; native stopping and logs are real. */
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createAcceptanceTask } from '@deepseek-ai/dsh-completion-claim-policy'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

const path = process.argv[2]
if (path === undefined) throw new Error('Missing composition path')
const ctx = await boot('task-acceptance-snapshot', path)
try {
  let mutationCalls = 0
  ctx.tools.register(defineContentToolFixture({ name: 'mutation_probe', description: 'Mutation sentinel', parameters: {},
    async execute() { mutationCalls++; return [{ type: 'text', text: 'mutated' }] },
  }))
  let probePending = true
  const answers = ['7F3D', 'LEON-CPP-7F3D-9206', 'bad', 'still bad', 'return a - b', 'return b + a']
  ctx.on('llm/stream', async function* (): AsyncGenerator<StreamChunk> {
    if (probePending) {
      probePending = false
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('mutation-probe'), name: 'mutation_probe', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = answers.shift()
    if (text === undefined) throw new Error('Unbounded recovery')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const agent = ctx.agents.roots()[0]
  if (agent === undefined) throw new Error('Composition did not create main')
  ctx.on('agent/error', () => {})
  for (const expected of ['LEON-CPP-7F3D-9206', 'expected', undefined]) {
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
        if (current === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createAcceptanceTask([{ type: 'text', text: expected === undefined ? 'Return the sum expression.' : 'Return the complete fixture code.' }], expected, {
      maxRecoveries: 1, readOnly: true,
      ...expected === undefined ? { arithmeticTests: [{ a: 2, b: 3, expected: 5 }] } : {},
    }))
    await idle
  }
  const transcript = agent.session.events.flatMap<object>((event) => {
    if (event.type === 'tool/result') return [{ type: event.type, content: event.data.message.content }]
    if (event.type === 'task/validation') {
      const { turn, attempt, status, reason } = event.data
      return [{ type: event.type, turn, attempt, status, reason }]
    }
    if (event.type === 'assistant/message') return [{ type: event.type, text: event.data.message.content }]
    if (event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'completion-claim-policy') return [{ type: 'correction', content: event.data.content }]
    if (event.type === 'turn/end') return [{ type: event.type, reason: event.data.reason }]
    return []
  })
  if (mutationCalls !== 0) throw new Error('Read-only tool body executed')
  process.stdout.write(JSON.stringify(transcript) + '\n')
} finally {
  await ctx.fiber.dispose()
}
