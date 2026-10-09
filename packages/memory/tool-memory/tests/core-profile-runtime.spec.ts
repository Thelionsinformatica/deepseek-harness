import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId, CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import PersonalMemoryRuntime, { PersonalMemoryOwnerId } from '@deepseek-ai/dsh-personal-memory'
import type { PersonalMemoryRecord } from '@deepseek-ai/dsh-personal-memory'
import * as PersonalMemoryLocal from '@deepseek-ai/dsh-personal-memory-local'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test-compaction': { kind: 'test-compaction' } & import('@deepseek-ai/dsh-llm').ContextFormed
    'test-overflow-recovery': { kind: 'test-overflow-recovery' } & import('@deepseek-ai/dsh-llm').ContextFormed
  }
}

const roots: string[] = []
const contexts: Context[] = []
const owner = { ownerId: PersonalMemoryOwnerId('runtime-core-owner') }
const fact = 'A preferência sintética é CANARY_PROFILE_OLD.'
const correctedFact = 'A preferência sintética é CANARY_PROFILE_NEW.'

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('dsh-core-profile-runtime-')) {
      throw new Error('refusing to remove a directory outside the owned test roots')
    }
    await rm(root, { recursive: true, force: true })
  }
})

/** The only model boundary is scripted; request history and the memory stack remain real. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  toolOnFirstRequest = false
  failAtRequest?: number
  failureCode = CONTEXT_WINDOW_EXCEEDED_CODE
  beforeFailure?: () => Promise<void>

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 32768 }, defaultMaxTokens: 1024 })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === this.failAtRequest) {
      await this.beforeFailure?.()
      throw new LlmError('Synthetic provider request failure.', this.failureCode)
    }
    if (this.toolOnFirstRequest && this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end', index: 0,
        block: { type: 'tool-call', id: ToolCallId('runtime-core-step'), name: 'runtime_step', arguments: '{}' },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Resposta sintética.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Boot the production Loader, JSON memory provider, session persistence, and concrete agent loop. */
async function boot(
  root?: string,
  options: { telemetryEnabled?: boolean; compaction?: boolean } = {},
): Promise<{ ctx: Context; adapter: RecordingAdapter; root: string }> {
  if (root === undefined) {
    root = await mkdtemp(join(tmpdir(), 'dsh-core-profile-runtime-'))
    roots.push(root)
    await mkdir(join(root, 'workspace'))
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config: { agents: [] }',
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    `  config: { root: ${JSON.stringify(join(root, 'sessions'))} }`,
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    `  config: { root: ${JSON.stringify(join(root, 'storage'))} }`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config: { backend: json }',
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-memory'",
    '  config: { provider: local }',
    "- name: '@deepseek-ai/dsh-memory-local'",
    "- name: '@deepseek-ai/dsh-personal-memory'",
    `  config: { provider: local, telemetryEnabled: ${String(options.telemetryEnabled ?? true)} }`,
    "- name: '@deepseek-ai/dsh-personal-memory-local'",
    "- name: '@deepseek-ai/dsh-tool-memory'",
    '  config: { personalOwnerId: runtime-core-owner, personalAutomaticRecall: true }',
    ...options.compaction === true ? [
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-compaction-basic'",
      '  config: { thresholdRatio: 1, retainTokens: 0, summarizationProvider: summary-local, summarizationModel: summary-a, maxTokens: 1024 }',
    ] : [],
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-memory', MemoryRuntime],
    ['@deepseek-ai/dsh-memory-local', MemoryLocal],
    ['@deepseek-ai/dsh-personal-memory', PersonalMemoryRuntime],
    ['@deepseek-ai/dsh-personal-memory-local', PersonalMemoryLocal],
    ['@deepseek-ai/dsh-tool-memory', ToolMemory],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-compaction-basic', BasicCompactionEngine],
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
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['runtime-local'], adapter)
  return { ctx, adapter, root }
}

async function createAgent(ctx: Context, root: string): Promise<Agent> {
  return (await ctx.agents.create({
    sessionId: SessionId('core-profile-runtime'),
    meta: { cwd: join(root, 'workspace') },
    agentOptions: { provider: 'runtime-local', model: 'model-a' },
  })).agent
}

function remember(ctx: Context, content = fact, core = true): Promise<PersonalMemoryRecord> {
  return ctx.personalMemory.create({
    scope: owner, content, core, validation: 'explicit',
    source: { kind: 'session', sessionId: SessionId('synthetic-memory-source') },
  })
}

function messageText(messages: GenerateOptions['messages']): string {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function lastRequest(adapter: RecordingAdapter): GenerateOptions {
  const request = adapter.requests.at(-1)
  if (request === undefined) throw new Error('the actual model adapter did not receive a request')
  return request
}

async function turn(agent: Agent, text = 'oi'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
}

function expectRetainedHistory(agent: Agent): void {
  const original = agent.session.snapshotEvents().find(event => event.type === 'user/message'
    && messageText([event.data]).includes(fact))
  expect(original).toBeDefined()
  if (original === undefined) throw new Error('expected the original durable snapshot')
  expect(agent.session.surface.nodes).not.toContain(original.seq)
}

describe('personal core profile through the real loop, Loader, and durable request surface', () => {
  it('keeps one core and one recalled fact in the complete request after two turns', async () => {
    const { ctx, adapter, root } = await boot()
    await remember(ctx)
    const reference = 'A referência sintética contém RUNTIME_REFERENCE_CANARY.'
    await remember(ctx, reference, false)
    const agent = await createAgent(ctx, root)

    await turn(agent, 'referência sintética')
    await turn(agent, 'referência sintética')

    expect(adapter.requests).toHaveLength(2)
    for (const request of adapter.requests) {
      const text = messageText(request.messages)
      expect(text.split(fact)).toHaveLength(2)
      expect(text.split(reference)).toHaveLength(2)
    }
    expect(lastRequest(adapter).messages).toEqual(agent.session.deriveMessages().slice(0, -1))
  })

  it('withdraws an unconfirmed correction from core and query recall while preserving the original log', async () => {
    const { ctx, adapter, root } = await boot()
    const record = await remember(ctx)
    const agent = await createAgent(ctx, root)
    await turn(agent)
    await ctx.personalMemory.update({
      scope: owner, ref: { id: record.id, revision: record.revision },
      content: correctedFact,
    })

    await turn(agent, 'preferência sintética')

    const text = messageText(lastRequest(adapter).messages)
    expect(text).not.toContain(fact)
    expect(text).not.toContain(correctedFact)
    expectRetainedHistory(agent)
  })

  it.each(['forget', 'disable', 'unmark', 'unconfirmed-correction'] as const)(
    'removes an already-injected snapshot from subsequent requests after %s, retaining the audit log',
    async (operation) => {
      const { ctx, adapter, root } = await boot()
      const record = await remember(ctx)
      const agent = await createAgent(ctx, root)
      await turn(agent)
      expect(messageText(lastRequest(adapter).messages)).toContain(fact)
      const ref = { id: record.id, revision: record.revision }
      if (operation === 'forget') await ctx.personalMemory.forget({ scope: owner, ref })
      else if (operation === 'disable') ctx.personalMemory.setEnabled(false)
      else await ctx.personalMemory.update({
        scope: owner, ref,
        content: operation === 'unmark' ? fact : correctedFact,
        ...(operation === 'unmark' ? { core: false } : {}),
      })

      await turn(agent)

      const text = messageText(lastRequest(adapter).messages)
      expect(text).not.toContain(fact)
      expect(text).not.toContain(correctedFact)
      expectRetainedHistory(agent)
    },
  )

  it('suppresses both retained core and pending recall when disabled while a real search result is in flight', async () => {
    const { ctx, adapter, root } = await boot()
    await remember(ctx)
    const reference = 'O arquivo de referência contém SEARCH_RACE_CANARY.'
    await remember(ctx, reference, false)
    const agent = await createAgent(ctx, root)
    await turn(agent)
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const originalSearch = ctx.personalMemory.search.bind(ctx.personalMemory)
    vi.spyOn(ctx.personalMemory, 'search').mockImplementationOnce(async (...args) => {
      const result = await originalSearch(...args)
      entered.resolve(undefined)
      await released.promise
      return result
    })

    const pending = turn(agent, 'arquivo de referência')
    try {
      await entered.promise
      ctx.personalMemory.setEnabled(false)
    } finally {
      released.resolve(undefined)
    }
    await pending

    expect(adapter.requests).toHaveLength(2)
    const text = messageText(lastRequest(adapter).messages)
    expect(text).not.toContain(fact)
    expect(text).not.toContain(reference)
    expectRetainedHistory(agent)
  })

  it('restores core after a surface replacement before step two of the same turn', async () => {
    const { ctx, adapter, root } = await boot()
    await remember(ctx)
    adapter.toolOnFirstRequest = true
    ctx.tools.register(defineContentToolFixture({
      name: 'runtime_step', description: 'Finish one synthetic local step.', parameters: {},
      execute: async () => [{ type: 'text', text: 'Etapa sintética concluída.' }],
    }))
    let replaced = false
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      if (step === 2) {
        const nodes = new Set(agent.session.surface.nodes)
        const original = agent.session.snapshotEvents().find(event => nodes.has(event.seq)
          && event.type === 'user/message' && event.data.source.kind === 'tool-memory'
          && event.data.source.form === 'snapshot'
          && event.data.source.sections.some(section => section.name === 'personal-memory:core'))
        if (original === undefined) throw new Error('expected step one to retain its core snapshot')
        if (original.type !== 'user/message') throw new Error('expected a user-message projection')
        expect(messageText([original.data])).not.toContain(fact)
        agent.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'Resumo sintético sem dados pessoais.' }],
          source: { kind: 'test-compaction' },
        }), {
          surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq },
          sourceEventSeqs: [original.seq],
        })
        replaced = true
      }
      return next()
    })
    const agent = await createAgent(ctx, root)

    await turn(agent)

    expect(replaced).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    expect(messageText(lastRequest(adapter).messages).split(fact)).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start').map(event => event.data.step)).toEqual([1, 2])
  })

  it('recomposes current core after overflow recovery retries the same step without another pre-step', async () => {
    const { ctx, adapter, root } = await boot()
    const record = await remember(ctx)
    const retainedFact = 'O perfil confirmado preserva OVERFLOW_RETAINED_CANARY.'
    await remember(ctx, retainedFact)
    adapter.failAtRequest = 1
    let preSteps = 0
    let recoveries = 0
    ctx.on('agent/pre-step', async (_payload, next) => {
      preSteps += 1
      return next()
    })
    ctx.on('agent/request-error', async ({ agent, failure, step }) => {
      expect(failure.code).toBe(CONTEXT_WINDOW_EXCEEDED_CODE)
      expect(step).toBe(1)
      recoveries += 1
      // The outer memory listener must sanitize the surface before downstream recovery.
      expect(messageText(agent.session.deriveMessages())).not.toContain(fact)
      expect(messageText(agent.session.deriveMessages())).not.toContain(retainedFact)
      await ctx.personalMemory.forget({ scope: owner, ref: { id: record.id, revision: record.revision } })
      // Node 0 is the system prompt, which only a system/message may replace.
      const nodes = agent.session.surface.nodes.slice(1)
      const start = nodes[0]
      const end = nodes.at(-1)
      if (start === undefined || end === undefined) throw new Error('expected a populated recovery surface')
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Recuperação sintética sem dados pessoais.' }],
        source: { kind: 'test-overflow-recovery' },
      }), { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: [...nodes] })
      return { kind: 'retry' }
    })
    const agent = await createAgent(ctx, root)

    await turn(agent)

    expect(preSteps).toBe(1)
    expect(recoveries).toBe(1)
    expect(adapter.requests).toHaveLength(2)
    expect(messageText(adapter.requests[0]!.messages)).toContain(fact)
    const retriedText = messageText(lastRequest(adapter).messages)
    expect(retriedText).not.toContain(fact)
    expect(retriedText.split(retainedFact)).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
    expectRetainedHistory(agent)
  })

  it.each(['disable-enable', 'update'] as const)(
    'discards a stale core and search read after %s with operation telemetry disabled',
    async (operation) => {
      const { ctx, adapter, root } = await boot(undefined, { telemetryEnabled: false })
      const emittedOperations: unknown[] = []
      ctx.on('personal-memory/operation', (event) => { emittedOperations.push(event) })
      const record = await remember(ctx)
      const reference = 'A referência sintética contém VERSION_READ_CANARY.'
      await remember(ctx, reference, false)
      const agent = await createAgent(ctx, root)
      await turn(agent)
      const entered = Promise.withResolvers<undefined>()
      const released = Promise.withResolvers<undefined>()
      const originalSearch = ctx.personalMemory.search.bind(ctx.personalMemory)
      vi.spyOn(ctx.personalMemory, 'search').mockImplementationOnce(async (...args) => {
        const result = await originalSearch(...args)
        entered.resolve(undefined)
        await released.promise
        return result
      })
      const version = ctx.personalMemory.contextVersion

      const pending = turn(agent, 'referência sintética')
      try {
        await entered.promise
        if (operation === 'disable-enable') {
          ctx.personalMemory.setEnabled(false)
          ctx.personalMemory.setEnabled(true)
        } else {
          await ctx.personalMemory.update({
            scope: owner, ref: { id: record.id, revision: record.revision },
            content: correctedFact, validation: 'explicit',
          })
        }
      } finally {
        released.resolve(undefined)
      }
      await pending

      expect(ctx.personalMemory.isEnabled()).toBe(true)
      expect(ctx.personalMemory.contextVersion).toBeGreaterThan(version)
      expect(emittedOperations).toEqual([])
      expect(adapter.requests).toHaveLength(2)
      const staleReadText = messageText(lastRequest(adapter).messages)
      expect(staleReadText).not.toContain(fact)
      expect(staleReadText).not.toContain(correctedFact)
      expect(staleReadText).not.toContain(reference)
      expectRetainedHistory(agent)

      await turn(agent, 'referência sintética')
      const refreshedText = messageText(lastRequest(adapter).messages)
      expect(refreshedText.split(operation === 'update' ? correctedFact : fact)).toHaveLength(2)
      expect(refreshedText.split(reference)).toHaveLength(2)
      if (operation === 'update') expect(refreshedText).not.toContain(fact)
      expect(emittedOperations).toEqual([])
    },
  )

  it('uses the real overflow compactor and a simulated summary model before retrying with only current core', async () => {
    const { ctx, adapter, root } = await boot(undefined, { compaction: true })
    const summaryAdapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['summary-local'], summaryAdapter)
    const record = await remember(ctx)
    const retainedFact = 'A configuração confirmada contém REAL_COMPACTION_CORE_CANARY.'
    await remember(ctx, retainedFact)
    let preSteps = 0
    ctx.on('agent/pre-step', async (_payload, next) => {
      preSteps += 1
      return next()
    })
    const agent = await createAgent(ctx, root)
    await turn(agent, 'Histórico artificial sem fatos pessoais. '.repeat(180))
    adapter.failAtRequest = 2
    adapter.beforeFailure = async () => {
      await ctx.personalMemory.forget({ scope: owner, ref: { id: record.id, revision: record.revision } })
    }

    await turn(agent)

    expect(ctx.get('compaction')).toBeInstanceOf(BasicCompactionEngine)
    expect(ctx.get('tokenMeter')).toBeInstanceOf(TokenMeter)
    expect(preSteps).toBe(2)
    expect(adapter.requests).toHaveLength(3)
    expect(summaryAdapter.requests).toHaveLength(1)
    const summaryRequest = lastRequest(summaryAdapter)
    expect(summaryRequest.model).toBe('summary-a')
    expect(messageText(summaryRequest.messages)).toContain('Histórico artificial sem fatos pessoais.')
    expect(messageText(summaryRequest.messages)).not.toContain(fact)
    expect(messageText(summaryRequest.messages)).not.toContain(retainedFact)
    expect(messageText(adapter.requests[1]!.messages)).toContain(fact)
    const retriedText = messageText(lastRequest(adapter).messages)
    expect(retriedText).toContain('<compacted-summary>')
    expect(retriedText).not.toContain(fact)
    expect(retriedText.split(retainedFact)).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start').map(event => event.data.step)).toEqual([1, 1])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary')).toMatchObject([
      { data: { provider: 'summary-local', model: 'summary-a', llmStreamCall: true } },
    ])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'compaction/end')).toHaveLength(1)
    expectRetainedHistory(agent)
  })

  it.each(['disable', 'confirmed-correction'] as const)(
    'refreshes memory after %s during a non-overflow retry wait without another pre-step',
    async (operation) => {
      const { ctx, adapter, root } = await boot()
      const record = await remember(ctx)
      adapter.failAtRequest = 1
      adapter.failureCode = 'RATE_LIMIT'
      const entered = Promise.withResolvers<undefined>()
      const released = Promise.withResolvers<undefined>()
      let preSteps = 0
      let retries = 0
      ctx.on('agent/pre-step', async (_payload, next) => {
        preSteps += 1
        return next()
      })
      // Simulate only the external retry delay; the loop and request-error chain are real.
      ctx.on('agent/request-error', async ({ failure }) => {
        expect(failure.code).toBe('RATE_LIMIT')
        retries += 1
        entered.resolve(undefined)
        await released.promise
        return { kind: 'retry' }
      })
      const agent = await createAgent(ctx, root)

      const pending = turn(agent)
      try {
        await entered.promise
        if (operation === 'disable') ctx.personalMemory.setEnabled(false)
        else await ctx.personalMemory.update({
          scope: owner, ref: { id: record.id, revision: record.revision },
          content: correctedFact, validation: 'explicit',
        })
      } finally {
        released.resolve(undefined)
      }
      await pending

      expect(preSteps).toBe(1)
      expect(retries).toBe(1)
      expect(adapter.requests).toHaveLength(2)
      expect(messageText(adapter.requests[0]!.messages)).toContain(fact)
      const retriedText = messageText(lastRequest(adapter).messages)
      expect(retriedText).not.toContain(fact)
      if (operation === 'confirmed-correction') expect(retriedText.split(correctedFact)).toHaveLength(2)
      else expect(retriedText).not.toContain(correctedFact)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
      expectRetainedHistory(agent)
    },
  )

  it('reloads persisted memory and session history with a new model, then invalidates the old projection', async () => {
    const first = await boot()
    const record = await remember(first.ctx)
    const agent = await createAgent(first.ctx, first.root)
    await turn(agent)
    await first.ctx.sessions.flush(agent.session)
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const resumed = await boot(first.root)
    const restored = (await resumed.ctx.agents.resume({
      resumeSessionId: agent.id,
      agentOptions: { provider: 'runtime-local', model: 'model-b' },
    })).agent
    await turn(restored)

    expect(lastRequest(resumed.adapter).model).toBe('model-b')
    expect(messageText(lastRequest(resumed.adapter).messages).split(fact)).toHaveLength(2)
    await resumed.ctx.personalMemory.forget({ scope: owner, ref: { id: record.id, revision: record.revision } })
    await turn(restored)
    expect(messageText(lastRequest(resumed.adapter).messages)).not.toContain(fact)
    expectRetainedHistory(restored)
  })
})
