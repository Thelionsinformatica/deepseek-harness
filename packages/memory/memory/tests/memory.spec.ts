import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  MemoryId,
  type MemoryBlockedEvent,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
  type MemoryListRequest,
  type MemoryOperationEvent,
  type MemoryProvider,
  type MemoryRecord,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
} from '@deepseek-ai/dsh-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

const scope = { workspaceId: WorkspaceId('workspace') }
const source = { kind: 'session' as const, sessionId: SessionId('session') }

function record(content = 'memory'): MemoryRecord {
  return {
    id: MemoryId('id'),
    scope,
    content,
    revision: 1,
    source,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  }
}

function provider(id: string, usable = true): MemoryProvider {
  return {
    id,
    available: () => usable,
    create: request => Promise.resolve(record(request.content)),
    search: () => Promise.resolve([{ record: record(), score: 1 }]),
    list: () => Promise.resolve({
      items: [{ record: record(), status: 'active' }],
      hasMore: false,
      nextOffset: 1,
    }),
    update: request => Promise.resolve(record(request.content)),
    forget: () => Promise.resolve(),
  }
}

async function harness(config: ConstructorParameters<typeof MemoryRuntime>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(MemoryRuntime, config)
  return ctx
}

describe('MemoryRuntime provider selection', () => {
  it('auto-selects exactly one usable provider and ignores an unavailable peer', async () => {
    const ctx = await harness()
    ctx.memory.registerProvider(provider('offline', false))
    ctx.memory.registerProvider(provider('local'))
    await expect(ctx.memory.create({ scope, content: ' selected ', source }))
      .resolves.toMatchObject({ content: 'selected' })
  })

  it('fails for no provider, ambiguous providers, and a missing configured provider', async () => {
    const empty = await harness()
    await expect(empty.memory.search({ scope, query: 'q', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_UNAVAILABLE' }))

    const ambiguous = await harness()
    ambiguous.memory.registerProvider(provider('first'))
    ambiguous.memory.registerProvider(provider('second'))
    await expect(ambiguous.memory.search({ scope, query: 'q', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_AMBIGUOUS' }))

    const configured = await harness({ provider: 'letta' })
    configured.memory.registerProvider(provider('local'))
    await expect(configured.memory.search({ scope, query: 'q', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('rejects duplicate ids and a configured unusable provider', async () => {
    const ctx = await harness({ provider: 'local' })
    ctx.memory.registerProvider(provider('local', false))
    expect(() => ctx.memory.registerProvider(provider('local')))
      .toThrow(expect.objectContaining({ code: 'MEMORY_DUPLICATE_PROVIDER' }))
    await expect(ctx.memory.search({ scope, query: 'q', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('forwards cancellation and caps an over-returning provider result', async () => {
    const ctx = await harness()
    const seen: Array<AbortSignal | undefined> = []
    const scripted = provider('local')
    scripted.search = (_request: MemorySearchRequest, signal?: AbortSignal) => {
      seen.push(signal)
      return Promise.resolve([
        { record: { ...record(), id: MemoryId('one') }, score: 2 },
        { record: { ...record(), id: MemoryId('two') }, score: 1 },
      ])
    }
    ctx.memory.registerProvider(scripted)
    const abort = new AbortController()
    await expect(ctx.memory.search({ scope, query: 'q', limit: 1 }, abort.signal))
      .resolves.toHaveLength(1)
    expect(seen).toEqual([abort.signal])
  })

  it('normalizes content once before all mutating provider calls', async () => {
    const ctx = await harness()
    const create = vi.fn((request: MemoryCreateRequest) => Promise.resolve(record(request.content)))
    const update = vi.fn((request: MemoryUpdateRequest) => Promise.resolve(record(request.content)))
    const forget = vi.fn((_request: MemoryForgetRequest) => Promise.resolve())
    ctx.memory.registerProvider({ ...provider('local'), create, update, forget })

    await ctx.memory.create({ scope, content: '  remembered  ', source })
    await ctx.memory.update({ scope, ref: { id: MemoryId('id'), revision: 1 }, content: '  corrected  ' })
    await ctx.memory.forget({ scope, ref: { id: MemoryId('id'), revision: 1 } })

    expect(create.mock.calls[0]?.[0].content).toBe('remembered')
    expect(update.mock.calls[0]?.[0].content).toBe('corrected')
    expect(forget).toHaveBeenCalledOnce()
  })

  it('validates and forwards bounded provider-neutral administrative listing', async () => {
    const ctx = await harness()
    const list = vi.fn((_request: MemoryListRequest) => Promise.resolve({
      items: [{ record: record(), status: 'active' as const }],
      hasMore: false,
      nextOffset: 1,
    }))
    ctx.memory.registerProvider({ ...provider('local'), list })

    await expect(ctx.memory.list({
      scope,
      query: '  servidor  ',
      statuses: ['active', 'active'],
      limit: 25,
    })).resolves.toMatchObject({ items: [{ status: 'active' }] })
    expect(list.mock.calls[0]?.[0]).toMatchObject({
      query: 'servidor',
      statuses: ['active'],
      offset: 0,
      limit: 25,
    })
    await expect(ctx.memory.list({ scope, query: '   ', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_QUERY' }))
    await expect(ctx.memory.list({ scope, offset: -1, limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_OFFSET' }))
    await expect(ctx.memory.list({ scope, limit: 201 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_LIMIT' }))
    await expect(ctx.memory.list({ scope, statuses: ['unknown' as 'active'], limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_STATUS' }))
    await expect(ctx.memory.list({ scope, query: 'x'.repeat(2_049), limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_QUERY' }))
    await expect(ctx.memory.list({ scope, offset: 1.5, limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_OFFSET' }))
    await expect(ctx.memory.list({ scope, limit: 0 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_LIMIT' }))
    await expect(ctx.memory.list({ scope, limit: 1.5 }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_LIMIT' }))
  })

  it('emits a sanitized block and preserves provider list failures', async () => {
    const ctx = await harness()
    const blocked: MemoryBlockedEvent[] = []
    ctx.on('memory/blocked', event => blocked.push(event))
    const failure = Object.assign(new Error('private provider detail'), { code: 'MEMORY_PROVIDER_UNAVAILABLE' })
    ctx.memory.registerProvider({ ...provider('local'), list: () => Promise.reject(failure) })

    await expect(ctx.memory.list({ scope, limit: 10 })).rejects.toBe(failure)
    expect(blocked).toMatchObject([{
      reason: 'provider-unavailable',
      source: 'memory-runtime',
      workspaceId: scope.workspaceId,
      detail: 'MEMORY_PROVIDER_UNAVAILABLE',
    }])
    expect(JSON.stringify(blocked)).not.toContain('private provider detail')
  })

  it('validates and forwards optional ranking metadata at the provider-neutral boundary', async () => {
    const ctx = await harness()
    const create = vi.fn((request: MemoryCreateRequest) => Promise.resolve({
      ...record(request.content),
      ...(request.importance === undefined ? {} : { importance: request.importance }),
      ...(request.confidence === undefined ? {} : { confidence: request.confidence }),
      ...(request.validation === undefined ? {} : { validation: request.validation }),
    }))
    ctx.memory.registerProvider({ ...provider('local'), create })

    await expect(ctx.memory.create({
      scope,
      content: 'validated memory',
      source,
      importance: 0.8,
      confidence: 0.95,
      validation: 'reviewed',
    })).resolves.toMatchObject({ importance: 0.8, confidence: 0.95, validation: 'reviewed' })
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      importance: 0.8,
      confidence: 0.95,
      validation: 'reviewed',
    })

    for (const importance of [Number.NaN, -0.1, 2]) {
      await expect(ctx.memory.create({ ...{ scope, content: 'bad', source }, importance }))
        .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_IMPORTANCE' }))
    }
    for (const confidence of [Number.NaN, -0.1, 2]) {
      await expect(ctx.memory.create({ ...{ scope, content: 'bad', source }, confidence }))
        .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_CONFIDENCE' }))
    }
    await expect(ctx.memory.create({ scope, content: 'explicit', source, validation: 'explicit' }))
      .resolves.toMatchObject({ content: 'explicit' })
    await expect(ctx.memory.create({
      scope,
      content: 'bad',
      source,
      validation: 'unknown' as 'reviewed',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_VALIDATION' }))
  })

  it('normalizes temporal bounds and forwards an explicit history search', async () => {
    const ctx = await harness()
    const create = vi.fn((request: MemoryCreateRequest) => Promise.resolve({
      ...record(request.content),
      ...(request.validFrom === undefined ? {} : { validFrom: request.validFrom }),
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    }))
    const search = vi.fn((_request: MemorySearchRequest) => Promise.resolve([]))
    const update = vi.fn((request: MemoryUpdateRequest) => Promise.resolve(record(request.content)))
    ctx.memory.registerProvider({ ...provider('local'), create, search, update })

    await ctx.memory.create({
      scope,
      content: 'temporária',
      source,
      validFrom: '2026-08-25T13:00:00-03:00',
      expiresAt: '2026-08-25T17:00:00.000Z',
    })
    await ctx.memory.search({ scope, query: 'temporária', limit: 8, includeHistory: true })
    await ctx.memory.update({
      scope,
      ref: { id: MemoryId('id'), revision: 1 },
      content: 'sem expiração',
      validFrom: '2026-08-25T14:00:00-03:00',
      expiresAt: null,
    })

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      validFrom: '2026-08-25T16:00:00.000Z',
      expiresAt: '2026-08-25T17:00:00.000Z',
    })
    expect(search.mock.calls[0]?.[0]).toMatchObject({ includeHistory: true })
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      validFrom: '2026-08-25T17:00:00.000Z',
      expiresAt: null,
    })
    await expect(ctx.memory.create({
      scope,
      content: 'inválida',
      source,
      validFrom: 'not-a-date',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_TEMPORAL' }))
    await expect(ctx.memory.create({
      scope,
      content: 'ordem inválida',
      source,
      validFrom: '2026-08-25T18:00:00.000Z',
      expiresAt: '2026-08-25T17:00:00.000Z',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_TEMPORAL' }))
    await expect(ctx.memory.update({
      scope,
      ref: { id: MemoryId('id'), revision: 1 },
      content: 'data inválida',
      expiresAt: 'not-a-date',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_TEMPORAL' }))
    await expect(ctx.memory.update({
      scope,
      ref: { id: MemoryId('id'), revision: 1 },
      content: 'ordem inválida',
      validFrom: '2026-08-25T18:00:00.000Z',
      expiresAt: '2026-08-25T17:00:00.000Z',
    })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_TEMPORAL' }))
  })

  it('emits runtime memory operation events when telemetry is enabled', async () => {
    const ctx = await harness()
    const events: MemoryOperationEvent[] = []
    const scripted = provider('local')
    vi.spyOn(scripted, 'create')
    vi.spyOn(scripted, 'search')
    vi.spyOn(scripted, 'update')
    vi.spyOn(scripted, 'forget')
    ctx.memory.registerProvider(scripted)
    ctx.on('memory/operation', event => events.push(event))

    const created = await ctx.memory.create({ scope, content: ' mem  ', source })
    await ctx.memory.search({ scope, query: 'mem', limit: 1 })
    await ctx.memory.list({ scope, limit: 10 })
    await ctx.memory.update({ scope, ref: { id: created.id, revision: 1 }, content: 'corrigido' })
    await ctx.memory.forget({ scope, ref: { id: created.id, revision: 1 } })

    expect(events.map(event => event.operation)).toEqual(['create', 'search', 'list', 'update', 'forget'])
    expect(events).toHaveLength(5)
    for (const event of events) {
      expect(event.schemaVersion).toBe(3)
      expect(event.success).toBe(true)
      expect(event.provider).toBe('local')
      expect(event.workspaceId).toBe(scope.workspaceId)
    }
  })

  it('suppresses telemetry when telemetryEnabled is false', async () => {
    const ctx = await harness({ telemetryEnabled: false })
    const events: Array<MemoryOperationEvent | MemoryBlockedEvent> = []
    ctx.on('memory/operation', event => events.push(event))
    ctx.on('memory/blocked', event => events.push(event))
    const scripted = provider('local')
    ctx.memory.registerProvider(scripted)

    const created = await ctx.memory.create({ scope, content: 'memoria', source })
    await ctx.memory.search({ scope, query: 'mem', limit: 1 })
    await ctx.memory.update({ scope, ref: { id: created.id, revision: 1 }, content: 'corrigido' })

    expect(events).toHaveLength(0)
  })
})
