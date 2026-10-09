/** Synthetic loopback failures and complete graph inputs; storage stays in the runner's temporary cwd. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { MemoryGraphEvent } from '@deepseek-ai/dsh-memory-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

const [config] = process.argv.slice(2)
assert.ok(config)
const accepted: string[] = []
let requests = 0
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  assert.equal(request.url, '/v1/embeddings')
  const chunks: string[] = []
  request.setEncoding('utf8')
  for await (const value of request) {
    const chunk: unknown = value
    assert.equal(typeof chunk, 'string')
    chunks.push(chunk as string)
  }
  const { input } = JSON.parse(chunks.join('')) as { input: string[] }
  assert.ok(++requests < 200)
  response.setHeader('content-type', 'application/json')
  if (requests === 1) {
    response.writeHead(503).end(JSON.stringify({ error: 'synthetic startup delay' }))
  } else if (input.length > 1 || input[0]!.length > 100) {
    response.writeHead(400).end(JSON.stringify({ error: { code: 'context_length_exceeded' } }))
  } else {
    accepted.push(input[0]!.slice('search_document: '.length))
    response.end(JSON.stringify({ data: [{ index: 0,
      embedding: Array.from({ length: 64 }, (_, axis) => axis === 0 ? 1 : 0) }] }))
  }
}
const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    console.error(error)
    response.writeHead(500).end(JSON.stringify({ error: 'synthetic fixture failure' }))
  })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
process.env.LEON_GRAPH_TEST_ENDPOINT = `http://127.0.0.1:${address.port}`
try {
  const ctx = await boot('memory-graph-recovery', config)
  try {
    const statuses: string[] = []
    ctx.on('memory/graph', (event: MemoryGraphEvent) => { statuses.push(event.status) })
    const scope = { workspaceId: WorkspaceId('synthetic-graph') }
    const source = { kind: 'session' as const, sessionId: SessionId('synthetic-graph') }
    const content = 'Complete synthetic text. '.repeat(40).trim()
    const first = await ctx.memory.create({ scope, content, source })
    const second = await ctx.memory.create({ scope, content, source })
    const until = Date.now() + 10_000
    let graph = await ctx.memory.graph({ scope })
    while (graph.status !== 'computed' && Date.now() < until) {
      await setTimeout(10)
      graph = await ctx.memory.graph({ scope })
    }
    assert.equal(graph.status, 'computed')
    assert.equal(graph.algorithmVersion, 2)
    assert.deepEqual(graph.recordRevisions, { [first.id]: 1, [second.id]: 1 })
    assert.deepEqual(statuses, ['failed', 'computed'])
    assert.equal(accepted.join(''), content + content)
    const disk = JSON.parse(await readFile(join(process.cwd(), 'store', 'memory_local.json'), 'utf8')) as {
      tables: { memories: Record<string, { content: string }> }
    }
    assert.deepEqual(Object.values(disk.tables.memories).map(row => row.content), [content, content])
    process.stdout.write(JSON.stringify({ status: graph.status, algorithmVersion: graph.algorithmVersion,
      records: Object.keys(graph.recordRevisions).length, edges: graph.edges.length,
      statuses, contentPreserved: true, completeInputCoverage: true }) + '\n')
  } finally {
    await ctx.fiber.dispose()
  }
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error)
    else resolve()
  }))
}
