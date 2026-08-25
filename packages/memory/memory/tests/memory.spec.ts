import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRuntime, {
  MemoryId,
  type MemoryBlockedEvent,
  type MemoryCreateRequest,
  type MemoryForgetRequest,
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
    await ctx.memory.update({ scope, ref: { id: created.id, revision: 1 }, content: 'corrigido' })
    await ctx.memory.forget({ scope, ref: { id: created.id, revision: 1 } })

    expect(events.map(event => event.operation)).toEqual(['create', 'search', 'update', 'forget'])
    expect(events).toHaveLength(4)
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
