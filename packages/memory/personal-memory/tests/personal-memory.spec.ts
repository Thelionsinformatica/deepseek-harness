import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import PersonalMemoryRuntime, {
  PersonalMemoryOwnerId,
  type PersonalMemoryCreateRequest,
  type PersonalMemoryProvider,
  type PersonalMemoryRecord,
} from '@deepseek-ai/dsh-personal-memory'
import { SessionId } from '@deepseek-ai/dsh-session'

const scope = { ownerId: PersonalMemoryOwnerId('leon-local-owner') }
const source = { kind: 'session' as const, sessionId: SessionId('personal-session') }

function record(content = 'Leon prefere respostas em português.'): PersonalMemoryRecord {
  return {
    id: MemoryId('personal-one'),
    scope,
    content,
    revision: 1,
    source,
    createdAt: '2026-08-25T12:00:00.000Z',
    updatedAt: '2026-08-25T12:00:00.000Z',
  }
}

function provider(id = 'local'): PersonalMemoryProvider {
  return {
    id,
    available: () => true,
    create: request => Promise.resolve(record(request.content)),
    search: () => Promise.resolve([{ record: record(), score: 1 }]),
    list: () => Promise.resolve({
      items: [{ record: record(), status: 'active' }],
      hasMore: false,
      nextOffset: 1,
    }),
    update: request => Promise.resolve({ ...record(request.content), revision: request.ref.revision + 1 }),
    forget: () => Promise.resolve(),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(PersonalMemoryRuntime, { provider: 'local' })
  return ctx
}

describe('PersonalMemoryRuntime', () => {
  it('normalizes CRUD requests and emits content-free operation events', async () => {
    const ctx = await harness()
    const create = vi.fn((request: PersonalMemoryCreateRequest) => Promise.resolve(record(request.content)))
    const local = { ...provider(), create }
    ctx.personalMemory.registerProvider(local)
    const events: unknown[] = []
    ctx.on('personal-memory/operation', event => events.push(event))

    const created = await ctx.personalMemory.create({ scope, content: '  Prefere respostas diretas.  ', source })
    const hits = await ctx.personalMemory.search({ scope, query: '  respostas  ', limit: 4 })
    const page = await ctx.personalMemory.list({ scope, statuses: ['active', 'active'], limit: 20 })
    const corrected = await ctx.personalMemory.update({
      scope,
      ref: { id: created.id, revision: 1 },
      content: ' Prefere respostas diretas em português. ',
      source,
    })
    await ctx.personalMemory.forget({ scope, ref: { id: corrected.id, revision: 2 } })

    expect(create.mock.calls[0]?.[0].content).toBe('Prefere respostas diretas.')
    expect(hits).toHaveLength(1)
    expect(page.items).toHaveLength(1)
    expect(corrected.content).toBe('Prefere respostas diretas em português.')
    expect(events).toMatchObject([
      { operation: 'create', ownerId: scope.ownerId, success: true },
      { operation: 'search', ownerId: scope.ownerId, success: true, resultCount: 1 },
      { operation: 'list', ownerId: scope.ownerId, success: true, resultCount: 1 },
      { operation: 'update', ownerId: scope.ownerId, success: true },
      { operation: 'forget', ownerId: scope.ownerId, success: true },
    ])
    await ctx.fiber.dispose()
  })

  it('rejects credentials before calling a provider', async () => {
    const ctx = await harness()
    const base = provider()
    const create = vi.fn((request: PersonalMemoryCreateRequest, signal?: AbortSignal) => base.create(request, signal))
    ctx.personalMemory.registerProvider({ ...base, create })
    const blocked: unknown[] = []
    ctx.on('personal-memory/blocked', event => blocked.push(event))
    const secret = ['sk', 'proj', 'fixturepersonal1234567890'].join('-')

    await expect(ctx.personalMemory.create({ scope, content: `API key = ${secret}`, source }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_SENSITIVE_CONTENT' }))
    expect(create).not.toHaveBeenCalled()
    expect(blocked).toMatchObject([{
      operation: 'create',
      reason: 'credential-like',
      errorCode: 'PERSONAL_MEMORY_SENSITIVE_CONTENT',
    }])
    expect(JSON.stringify(blocked)).not.toContain(secret)
    await ctx.fiber.dispose()
  })

  it('validates ownership, limits, stale references, and provider selection', async () => {
    const ctx = await harness()
    ctx.personalMemory.registerProvider(provider())
    await expect(ctx.personalMemory.search({ scope, query: ' ', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_INVALID_QUERY' }))
    await expect(ctx.personalMemory.search({ scope, query: 'x', limit: 51 }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_INVALID_LIMIT' }))
    await expect(ctx.personalMemory.list({ scope, offset: -1, limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_INVALID_OFFSET' }))
    await expect(ctx.personalMemory.forget({
      scope: { ownerId: PersonalMemoryOwnerId('../other') },
      ref: { id: MemoryId('x'), revision: 1 },
    })).rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_INVALID_OWNER' }))
    await expect(ctx.personalMemory.forget({
      scope,
      ref: { id: MemoryId('x'), revision: 0 },
    })).rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_INVALID_REVISION' }))
    await ctx.fiber.dispose()

    const missing = new Context()
    await missing.plugin(PersonalMemoryRuntime, { provider: 'missing' })
    await expect(missing.personalMemory.search({ scope, query: 'x', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_PROVIDER_MISSING' }))
    await missing.fiber.dispose()
  })

  it('disables model and mutation operations while preserving administrative listing', async () => {
    const ctx = await harness()
    const local = provider()
    ctx.personalMemory.registerProvider(local)
    ctx.personalMemory.setEnabled(false)

    expect(ctx.personalMemory.isEnabled()).toBe(false)
    await expect(ctx.personalMemory.search({ scope, query: 'preferência', limit: 1 }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_DISABLED' }))
    await expect(ctx.personalMemory.create({ scope, content: 'Prefere respostas diretas.', source }))
      .rejects.toThrow(expect.objectContaining({ code: 'PERSONAL_MEMORY_DISABLED' }))
    const page = await ctx.personalMemory.list({ scope, offset: 0, limit: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.record.content).toBe('Leon prefere respostas em português.')

    ctx.personalMemory.setEnabled(true)
    await expect(ctx.personalMemory.search({ scope, query: 'preferência', limit: 1 })).resolves.toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
