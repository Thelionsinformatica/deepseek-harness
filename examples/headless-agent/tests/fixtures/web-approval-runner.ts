/** Keyless driver over the runnable web-approval composition; no network providers are loaded. */
import { boot } from '@deepseek-ai/dsh-app-boot'
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

const config = process.argv[2]
if (config === undefined) throw new Error('web approval snapshot requires a config path')
const ctx = await boot('web-approval-snapshot', config)
try {
  const outbound: object[] = []
  ctx.web.registerSearchProvider({
    id: 'fixture', available: () => true,
    search: async (request) => {
      outbound.push({ operation: 'search', query: request.query })
      return { sources: [], truncated: false }
    },
  })
  ctx.web.registerFetchProvider({
    id: 'fixture', available: () => true,
    fetch: async (request) => {
      outbound.push({ operation: 'fetch', url: request.url })
      return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'PUBLIC_FIXTURE' }, truncated: false }
    },
  })
  const calls = [
    { id: 'search-denied', name: 'web_search', args: { queries: ['PRIVATE_CANARY'] } },
    { id: 'search-allowed', name: 'web_search', args: { queries: ['public topic'] } },
    { id: 'fetch-denied', name: 'web_fetch', args: { url: 'https://example.test/?private=PRIVATE_CANARY' } },
    { id: 'fetch-allowed', name: 'web_fetch', args: { url: 'https://example.test/public' } },
    { id: 'search-repeat', name: 'web_search', args: { queries: ['public topic'] } },
  ]
  // Replace the actual model transport; all approvals, tools, and session events remain real.
  const removeAdapter = ctx.on('llm/stream', async function* (options): AsyncGenerator<StreamChunk> {
    options.signal?.throwIfAborted()
    const call = calls.shift()
    if (call === undefined) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Teste concluído.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const id = CallId(call.id)
    const args = JSON.stringify(call.args)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  })
  const decisions: ApprovalOutcome[] = ['rejected', 'allowed-once', 'rejected', 'allowed-once', 'unavailable']
  ctx.on('approval/request', async () => decisions.shift() ?? 'unavailable')
  const events: SessionEvent[] = []
  try {
    await runFixtureTurn(ctx, { task: 'Teste de consentimento com dados fictícios.', onEvent: (_id, event) => { events.push(event) } })
    const transcript = events.flatMap<object>((event) => {
      switch (event.type) {
        case 'tool/call': return [{ type: event.type, callId: event.data.callId, name: event.data.name, arguments: event.data.arguments }]
        case 'approval/asked': return [{ type: event.type, tool: event.data.toolName, callId: event.data.callId, reason: event.data.reason }]
        case 'approval/decided': return [{ type: event.type, outcome: event.data.outcome }]
        case 'tool/result': return [{ type: event.type, isError: event.data.message.content[0].isError, content: event.data.message.content[0].content }]
        case 'turn/end': return [{ type: event.type, reason: event.data.reason }]
        default: return []
      }
    })
    process.stdout.write(`${JSON.stringify({ outbound, transcript })}\n`)
  } finally {
    removeAdapter()
  }
} finally {
  await ctx.fiber.dispose()
}
