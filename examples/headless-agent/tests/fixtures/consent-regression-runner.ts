/** Exercise automatic egress through a real Loader and agent loop with synthetic transports. */
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

const config = process.argv[2]
if (config === undefined) throw new Error('Consent regression requires a composition')
const ctx = await boot('consent-regression', config)
let cloudCalls = 0
class Transport extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.provider === 'cloud') {
      cloudCalls++
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'PUBLIC_OK' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'PUBLIC_OK' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (options.messages.some(message => message.content.some(block => block.type === 'tool-result'))) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'Synthetic local outage' } } }
      return
    }
    const name = options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).at(-1) ?? ''
    const id = CallId(`call-${name}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
try {
  ctx.llm.registerAdapter(['local', 'cloud'], new Transport())
  for (const name of ['terminal_read', 'crm_query', 'web_fetch']) ctx.tools.register(defineTool({
    name, description: 'Synthetic content fixture', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return name === 'web_fetch' ? 'PUBLIC_CONTENT' : 'PRIVATE_SYNTHETIC_CANARY' },
  }))
  const api = createApiProxy(ctx, {
    cwd: process.cwd(), defaultModelSelection: () => ({ provider: 'local', model: 'fixture' }),
    adaptiveModelSelection: () => ({ provider: 'local', model: 'fixture' }),
    adaptiveModelFailover: () => ({ provider: 'cloud', model: 'fixture', residency: 'external' }),
  })
  const request = <T>(payload: T) => ({ rpcId: RpcId('consent-test'), payload })
  const results = []
  for (const tool of ['terminal_read', 'crm_query', 'web_fetch']) {
    const sessionId = SessionId(`consent-${tool}`)
    const created = await api.sessions.create(request({ sessionId }))
    if (!created.result.ok) throw new Error(JSON.stringify(created.result.error))
    const selected = await api.sessions.selectModel(request({ sessionId, provider: 'local', model: 'fixture', automatic: true, externalFailoverConsent: true }))
    if (!selected.result.ok) throw new Error(JSON.stringify(selected.result.error))
    const before = cloudCalls
    const response = await api.sessions.prompt(request({ sessionId, content: [{ type: 'text', text: tool }], mode: 'queue' }))
    if (!response.result.ok) throw new Error(JSON.stringify(response.result.error))
    await ctx.agents.get(sessionId)?.whenIdle()
    const events = ctx.sessions.get(sessionId)?.events ?? []
    results.push({ tool, cloudCalls: cloudCalls - before, calls: events.filter(event => event.type === 'tool/call').length,
      failover: events.some(event => event.type === 'llm/failover') })
  }
  process.stdout.write(JSON.stringify(results))
} finally { await ctx.fiber.dispose() }
