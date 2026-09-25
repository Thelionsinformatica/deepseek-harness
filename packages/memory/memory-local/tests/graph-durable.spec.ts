import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import MemoryRuntime, { type MemoryGraphSnapshot } from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as MemoryLocal from '../src/index.ts'
import { localMemoryGraph, localMemoryRecord } from '../src/spec.ts'

const scope = { workspaceId: WorkspaceId('durable-graph-workspace') }
const source = { kind: 'session' as const, sessionId: SessionId('durable-graph-source') }
const roots = new Set<string>()
const contexts = new Set<Context>()
const diskDocument = z.object({
  unit: z.object({ name: z.literal('memory_local'), version: z.literal(1) }),
  tables: z.object({
    memories: z.record(z.string(), localMemoryRecord),
    graph: z.record(z.string(), localMemoryGraph),
  }),
})

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-graph-durable-'))
  roots.add(root)
  return root
}

async function close(ctx: Context): Promise<void> {
  await ctx.fiber.dispose()
  contexts.delete(ctx)
}

/** Use a real Loader and JSON backend; only the external embedding endpoint is replaced. */
async function boot(root: string, debounceMs = 0): Promise<Context> {
  const configPath = join(root, `cordis-${contexts.size}-${debounceMs}.yml`)
  const entries = [
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { name: '@deepseek-ai/dsh-memory', config: { provider: 'local' } },
    {
      name: '@deepseek-ai/dsh-memory-local',
      config: {
        semanticSearch: {
          enabled: true,
          baseUrl: 'http://127.0.0.1:8099',
          api: 'openai-compatible',
          model: 'deterministic-test-embeddings',
          dimensions: 64,
        },
        linking: { enabled: true, debounceMs, minScore: 0.9 },
      },
    },
  ]
  await writeFile(configPath, JSON.stringify(entries, null, 2))
  const ctx = new Context()
  contexts.add(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-memory', MemoryRuntime],
    ['@deepseek-ai/dsh-memory-local', MemoryLocal],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function stubEmbeddings() {
  const endpoint = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.href : _input.url
    expect(url).toBe('http://127.0.0.1:8099/v1/embeddings')
    const body = z.object({ input: z.array(z.string()) }).parse(JSON.parse(z.string().parse(init?.body)))
    const data = body.input.map((_content, index) => ({
      index,
      embedding: Array.from({ length: 64 }, (_value, dimension) => dimension === 0 ? 1 : 0),
    }))
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }))
  })
  vi.stubGlobal('fetch', endpoint)
  return endpoint
}

async function readDisk(root: string) {
  const text = await readFile(join(root, 'storage', 'memory_local.json'), 'utf8')
  return diskDocument.parse(JSON.parse(text))
}

async function awaitGraph(ctx: Context, expected: Partial<MemoryGraphSnapshot>): Promise<MemoryGraphSnapshot> {
  await vi.waitFor(async () => {
    expect(await ctx.memory.graph({ scope })).toMatchObject(expected)
  })
  return ctx.memory.graph({ scope })
}

describe('derived memory graphs through Loader and durable JSON storage', () => {
  it('persists exact edge revisions and reopens them before a delayed rebuild without inference on reads', async () => {
    const endpoint = stubEmbeddings()
    const root = await createRoot()
    const first = await boot(root)
    const original = await first.memory.create({ scope, content: 'Porta de suporte pendente.', source })
    const neighbor = await first.memory.create({ scope, content: 'Porta do atendimento.', source })
    await awaitGraph(first, { status: 'computed' })
    const revised = await first.memory.update({
      scope, ref: { id: original.id, revision: original.revision }, content: 'Porta de suporte validada.',
    })
    const expectedRevisions = { [original.id]: revised.revision, [neighbor.id]: neighbor.revision }
    const published = await awaitGraph(first, { status: 'computed', recordRevisions: expectedRevisions })
    expect(published.edges).toHaveLength(1)
    for (const edge of published.edges) {
      expect(edge.a.revision).toBe(expectedRevisions[edge.a.id])
      expect(edge.b.revision).toBe(expectedRevisions[edge.b.id])
    }
    const persisted = (await readDisk(root)).tables.graph[scope.workspaceId]
    expect(persisted).toMatchObject({ status: 'computed', recordRevisions: expectedRevisions, edges: published.edges })
    await close(first)

    endpoint.mockClear()
    const second = await boot(root, 60_000)
    const restored = await second.memory.graph({ scope })
    expect(restored).toMatchObject({
      status: 'stale',
      generation: published.generation,
      recordRevisions: expectedRevisions,
      edges: published.edges,
    })
    const records = await second.memory.list({ scope, limit: 10 })
    expect(records.items.map(item => [item.record.id, item.record.revision, item.status])).toEqual(expect.arrayContaining([
      [original.id, 1, 'superseded'], [original.id, 2, 'active'], [neighbor.id, 1, 'active'],
    ]))
    await second.memory.graph({ scope })
    await second.memory.graph({ scope })
    expect(endpoint).not.toHaveBeenCalled()
    expect((await readDisk(root)).tables.graph[scope.workspaceId]).toEqual(persisted)
    await close(second)
    expect(endpoint).not.toHaveBeenCalled()
  })

  it('keeps a forgotten partition empty on disk and after a fresh Loader without further embedding calls', async () => {
    const endpoint = stubEmbeddings()
    const root = await createRoot()
    const first = await boot(root)
    const a = await first.memory.create({ scope, content: 'Primeira referência.', source })
    const b = await first.memory.create({ scope, content: 'Segunda referência.', source })
    await awaitGraph(first, { status: 'computed' })
    await first.memory.forget({ scope, ref: a })
    await first.memory.forget({ scope, ref: b })
    const cleared = await awaitGraph(first, { status: 'empty', recordRevisions: {}, edges: [] })
    const persisted = await readDisk(root)
    expect(persisted.tables.memories).toEqual({})
    expect(persisted.tables.graph[scope.workspaceId]).toMatchObject({ status: 'empty', recordRevisions: {}, edges: [] })
    await close(first)

    endpoint.mockClear()
    const second = await boot(root)
    const restored = await awaitGraph(second, { status: 'empty', recordRevisions: {}, edges: [] })
    expect(restored.generation).toBeGreaterThan(cleared.generation)
    expect(await second.memory.list({ scope, limit: 10 })).toMatchObject({ items: [], hasMore: false })
    expect((await readDisk(root)).tables.memories).toEqual({})
    expect((await readDisk(root)).tables.graph[scope.workspaceId]).toMatchObject({
      status: 'empty', recordRevisions: {}, edges: [],
    })
    expect(endpoint).not.toHaveBeenCalled()
  })

  it('repairs a persisted stale graph after all records are forgotten and shutdown cancels its delayed rebuild', async () => {
    const endpoint = stubEmbeddings()
    const root = await createRoot()
    const first = await boot(root)
    const a = await first.memory.create({ scope, content: 'Referência antiga A.', source })
    const b = await first.memory.create({ scope, content: 'Referência antiga B.', source })
    await awaitGraph(first, { status: 'computed' })
    await close(first)

    const second = await boot(root, 60_000)
    await second.memory.forget({ scope, ref: a })
    await second.memory.forget({ scope, ref: b })
    await close(second)
    const interrupted = await readDisk(root)
    expect(interrupted.tables.memories).toEqual({})
    expect(interrupted.tables.graph[scope.workspaceId]?.edges).toHaveLength(1)

    endpoint.mockClear()
    const third = await boot(root)
    await awaitGraph(third, { status: 'empty', recordRevisions: {}, edges: [] })
    expect((await readDisk(root)).tables.graph[scope.workspaceId]).toMatchObject({
      status: 'empty', recordRevisions: {}, edges: [],
    })
    expect(endpoint).not.toHaveBeenCalled()
  })

  it('reopens the active historical revision before a future correction, then activates and expires exact revisions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    const endpoint = stubEmbeddings()
    const root = await createRoot()
    const first = await boot(root)
    const original = await first.memory.create({ scope, content: 'Contrato vigente.', source })
    const neighbor = await first.memory.create({
      scope, content: 'Condição contratual.', source, expiresAt: '2030-01-03T00:00:00.000Z',
    })
    const revised = await first.memory.update({
      scope,
      ref: original,
      content: 'Contrato futuro.',
      validFrom: '2030-01-02T00:00:00.000Z',
      expiresAt: '2030-01-03T00:00:00.000Z',
    })
    const before = await awaitGraph(first, {
      status: 'computed', recordRevisions: { [original.id]: 1, [neighbor.id]: 1 },
    })
    expect(before.edges).toHaveLength(1)
    await close(first)
    endpoint.mockClear()

    const beforeActivation = await boot(root, 60_000)
    expect(await beforeActivation.memory.graph({ scope })).toMatchObject({
      status: 'stale', recordRevisions: { [original.id]: 1, [neighbor.id]: 1 }, edges: before.edges,
    })
    expect(endpoint).not.toHaveBeenCalled()
    await close(beforeActivation)

    vi.setSystemTime(new Date('2030-01-02T12:00:00.000Z'))
    const afterActivation = await boot(root)
    const activated = await awaitGraph(afterActivation, {
      status: 'computed', recordRevisions: { [original.id]: revised.revision, [neighbor.id]: 1 },
    })
    expect(activated.edges).toHaveLength(1)
    expect(endpoint).toHaveBeenCalledTimes(1)
    const inputs = endpoint.mock.calls.map(([, init]) => z.string().parse(init?.body)).join('\n')
    expect(inputs).toContain('Contrato futuro.')
    expect(inputs).not.toContain('Contrato vigente.')
    expect((await readDisk(root)).tables.graph[scope.workspaceId]).toMatchObject({
      recordRevisions: activated.recordRevisions, edges: activated.edges,
    })
    await close(afterActivation)
    endpoint.mockClear()

    vi.setSystemTime(new Date('2030-01-03T12:00:00.000Z'))
    const afterExpiry = await boot(root)
    await awaitGraph(afterExpiry, { status: 'empty', recordRevisions: {}, edges: [] })
    expect((await afterExpiry.memory.list({ scope, limit: 10, statuses: ['active'] })).items).toEqual([])
    expect(Object.keys((await readDisk(root)).tables.memories)).toHaveLength(2)
    expect((await readDisk(root)).tables.graph[scope.workspaceId]).toMatchObject({
      status: 'empty', recordRevisions: {}, edges: [],
    })
    expect(endpoint).not.toHaveBeenCalled()
  })
})
