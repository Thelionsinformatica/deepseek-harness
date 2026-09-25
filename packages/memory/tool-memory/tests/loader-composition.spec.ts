import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { agentEvents, Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import PersonalMemoryRuntime, { PersonalMemoryOwnerId } from '@deepseek-ai/dsh-personal-memory'
import * as PersonalMemoryLocal from '@deepseek-ai/dsh-personal-memory-local'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { memoryCandidateDomainSpec, type MemoryCandidateRecord } from '../src/spec.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function registerAgent(ctx: Context, cwd: string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('memory-shadow-loader-agent')
  const session = ctx.sessions.create(id, { meta: { cwd } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox,
    ctx: scope.ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

/** Fire one first-step pre-step and return every injected text block. */
async function runPreStep(agent: Agent, text: string): Promise<string[]> {
  if (context === undefined) throw new Error('loader context was not initialized')
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const result = await agentEvents(context, agent).waterfall(
    'agent/pre-step',
    { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [message] }),
  )
  if (result.kind !== 'enter') return []
  return result.messages
    .filter(item => item.source.kind === 'plugin')
    .flatMap(item => item.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

/** Boot the production Loader seam with the local memory stack plus scenario-specific plugins. */
async function bootMemoryLoader(extraRows: string[]): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const workspacePath = join(root, 'workspace')
  await mkdir(workspacePath)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    `  config: { root: ${JSON.stringify(join(root, 'storage'))} }`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config: { backend: json }',
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-memory'",
    '  config: { provider: local }',
    "- name: '@deepseek-ai/dsh-memory-local'",
    ...extraRows,
    "- name: '@deepseek-ai/dsh-personal-memory'",
    '  config: { provider: local }',
    "- name: '@deepseek-ai/dsh-personal-memory-local'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  context.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
    load: () => Promise.reject(new Error('not used')),
    inspect: () => Promise.reject(new Error('not used')),
  } as never)
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-memory', MemoryRuntime],
    ['@deepseek-ai/dsh-memory-local', MemoryLocal],
    ['@deepseek-ai/dsh-personal-memory', PersonalMemoryRuntime],
    ['@deepseek-ai/dsh-personal-memory-local', PersonalMemoryLocal],
    ['@deepseek-ai/dsh-tool-memory', ToolMemory],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return workspacePath
}

describe('memory shadow extraction through a real Loader composition', () => {
  it('invalidates a changed personal memory confirmation through the loaded JSON provider', async () => {
    await bootMemoryLoader([])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('revision-owner') }
    const created = await context.personalMemory.create({
      scope, content: 'Verified deployment', confidence: 1, validation: 'reviewed',
      source: { kind: 'session', sessionId: SessionId('revision-source') },
    })
    const changed = await context.personalMemory.update({
      scope, ref: { id: created.id, revision: created.revision }, content: 'Deployment hypothesis',
    })
    expect(changed.validation).toBeUndefined()
    expect(changed.confidence).toBeUndefined()
    const current = await context.personalMemory.search({ scope, query: 'hypothesis', limit: 4 })
    expect(current[0]?.record).toMatchObject({ id: created.id, revision: 2, content: 'Deployment hypothesis' })
    expect(current[0]?.record.validation).toBeUndefined()
  })

  it('boots the isolated personal-memory service and local provider', async () => {
    await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: loader-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('loader-owner') }
    const created = await context.personalMemory.create({
      scope,
      content: 'O usuário prefere respostas diretas em português.',
      source: { kind: 'session', sessionId: SessionId('personal-loader-source') },
    })
    await expect(context.personalMemory.search({ scope, query: 'respostas portugues', limit: 4 }))
      .resolves.toMatchObject([{ record: { id: created.id } }])
    expect(context.storageDomain.get('personal_memory_local')).toBeDefined()
    expect(context.storageDomain.get('memory_local')).toBeDefined()
  })

  it('boots cordis.yml and persists only a review candidate', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { shadowExtraction: true, shadowOwnerId: loader-owner }',
    ])

    if (context === undefined) throw new Error('loader context was not initialized')
    const workspace = await context.workspaceRegistry.create(workspacePath)
    const agent = registerAgent(context, workspacePath)
    const message = createUserMessage({
      content: [{ type: 'text', text: 'A decisão do projeto é usar Ollama primeiro.' }],
      source: { kind: 'user' },
    })
    await agentEvents(context, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )

    const domain = context.storageDomain.get(memoryCandidateDomainSpec.name)
    const rows = [...(domain?.table('candidates').entries() ?? [])]
      .map(([, record]) => record) as MemoryCandidateRecord[]
    expect(rows).toMatchObject([{
      workspaceId: workspace.id,
      userId: 'loader-owner',
      operation: 'message_candidate',
      candidateContent: 'A decisão do projeto é usar Ollama primeiro.',
      policyDecision: 'shadow',
    }])
    await expect(context.memory.search({
      scope: { workspaceId: workspace.id },
      query: 'Ollama primeiro',
      limit: 8,
    })).resolves.toEqual([])
  })

  it('boots optional semantic retrieval and recalls a paraphrase through the real Loader seam', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected serialized embedding body')
      const body = JSON.parse(init.body) as { input: string[] }
      const embeddings = body.input.map((input) => {
        const axis = input.includes('Snapshots') || input.includes('cópias') ? 0 : 1
        return Array.from({ length: 64 }, (_value, index) => index === axis ? 1 : 0)
      })
      return new Response(JSON.stringify({ embeddings }), { status: 200 })
    }))
    const workspacePath = await bootMemoryLoader([
      '  config: { semanticSearch: { enabled: true, dimensions: 64, minimumScore: 0.5 } }',
    ])

    if (context === undefined) throw new Error('loader context was not initialized')
    const workspace = await context.workspaceRegistry.create(workspacePath)
    const created = await context.memory.create({
      scope: { workspaceId: workspace.id },
      content: 'Snapshots vault volume E.',
      source: { kind: 'session', sessionId: SessionId('semantic-loader-source') },
    })

    await expect(context.memory.search({
      scope: { workspaceId: workspace.id },
      query: 'Onde estão as cópias de segurança?',
      limit: 4,
    })).resolves.toMatchObject([{ record: { id: created.id } }])
  })

  it('injects the always-present core profile on a new session, even for a bare "oi"', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    await context.personalMemory.create({
      scope, content: 'O usuário se chama Alessandro.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    await context.personalMemory.create({
      scope, content: 'Fato não essencial sobre um projeto.',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })

    const agent = registerAgent(context, workspacePath)
    const message = createUserMessage({ content: [{ type: 'text', text: 'oi' }], source: { kind: 'user' } })
    const result = await agentEvents(context, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    expect(result.kind).toBe('enter')
    const coreText = (result.kind === 'enter' ? result.messages : [])
      .flatMap(item => item.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .find(text => text.includes('personal-core-profile'))
    expect(coreText).toBeDefined()
    expect(coreText).toContain('Alessandro')
    expect(coreText).not.toContain('não essencial')
  })

  it('does not inject the core profile when personal memory is disabled', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    await context.personalMemory.create({
      scope, content: 'O usuário se chama Alessandro.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    context.personalMemory.setEnabled(false)

    const agent = registerAgent(context, workspacePath)
    const message = createUserMessage({ content: [{ type: 'text', text: 'oi' }], source: { kind: 'user' } })
    const result = await agentEvents(context, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    const texts = (result.kind === 'enter' ? result.messages : [])
      .flatMap(item => item.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    expect(texts.some(text => text.includes('personal-core-profile'))).toBe(false)
  })

  it('invalidates a corrected core fact from the active projection', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    const created = await context.personalMemory.create({
      scope, content: 'Alessandro prefere café.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    const agent = registerAgent(context, workspacePath)

    const first = await runPreStep(agent, 'oi')
    expect(first.some(text => text.includes('café'))).toBe(true)

    await context.personalMemory.update({
      scope, ref: { id: created.id, revision: created.revision }, content: 'Alessandro prefere chá.',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })

    const second = await runPreStep(agent, 'oi')
    expect(second.some(text => text.includes('café'))).toBe(false)
    expect(second.some(text => text.includes('chá'))).toBe(false)
  })

  it('marks and unmarks an existing fact as core through update', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    const created = await context.personalMemory.create({
      scope, content: 'Alessandro usa Linux.', validation: 'explicit',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    const agent = registerAgent(context, workspacePath)

    let texts = await runPreStep(agent, 'oi')
    expect(texts.some(text => text.includes('Linux'))).toBe(false)

    const marked = await context.personalMemory.update({
      scope, ref: { id: created.id, revision: created.revision }, content: 'Alessandro usa Linux.', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    texts = await runPreStep(agent, 'oi')
    expect(texts.some(text => text.includes('Linux'))).toBe(true)

    await context.personalMemory.update({
      scope, ref: { id: created.id, revision: marked.revision }, content: 'Alessandro usa Linux.', core: false,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    texts = await runPreStep(agent, 'oi')
    expect(texts.some(text => text.includes('Linux'))).toBe(false)
  })

  it('removes a forgotten core fact from later turns', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    const created = await context.personalMemory.create({
      scope, content: 'Alessandro prefere café.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    await context.personalMemory.forget({ scope, ref: { id: created.id, revision: created.revision } })

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'oi')
    expect(texts.some(text => text.includes('café'))).toBe(false)
  })

  it('does not duplicate a core fact in the query recall of the same turn', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    await context.personalMemory.create({
      scope, content: 'Alessandro prefere café.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    await context.personalMemory.create({
      scope, content: 'O projeto usa Ollama.',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'café Ollama')
    expect(texts.filter(text => text.includes('café')).length).toBe(1)
    expect(texts.some(text => text.includes('Ollama'))).toBe(true)
  })

  it('finds a core fact beyond the first listing page', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'))
    const core = await context.personalMemory.create({
      scope, content: 'Alessandro prefere café.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    vi.setSystemTime(new Date('2026-09-22T12:00:01.000Z'))
    for (let i = 0; i < 201; i++) {
      await context.personalMemory.create({
        scope, content: `Fato ordinário ${i}.`,
        source: { kind: 'session', sessionId: SessionId('core-source') },
      })
    }
    const firstPage = await context.personalMemory.list({ scope, statuses: ['active'], offset: 0, limit: 200 })
    expect(firstPage.items).toHaveLength(200)
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.items.some(item => item.record.id === core.id)).toBe(false)

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'oi')
    expect(texts.some(text => text.includes('café'))).toBe(true)
  })

  it('keeps query recall available when the core listing fails', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    await context.personalMemory.create({
      scope, content: 'O projeto usa armazenamento local.',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    const list = vi.spyOn(PersonalMemoryLocal.LocalPersonalMemoryProvider.prototype, 'list')
      .mockRejectedValueOnce(new Error('synthetic core listing failure'))

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'armazenamento')
    expect(list).toHaveBeenCalledOnce()
    expect(texts.some(text => text.includes('personal-core-profile'))).toBe(false)
    expect(texts.some(text => text.includes('armazenamento local'))).toBe(true)
  })

  it('suppresses both snapshots when memory is disabled while search resolves', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const personalMemory = context.personalMemory
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    await personalMemory.create({
      scope, content: 'O usuário prefere respostas compactas.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    await personalMemory.create({
      scope, content: 'O projeto usa armazenamento local.',
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    const providerSearch = personalMemory.search.bind(personalMemory)
    const search = vi.spyOn(personalMemory, 'search')
      .mockImplementation(async (request, signal) => {
        const hits = await providerSearch(request, signal)
        personalMemory.setEnabled(false)
        return hits
      })

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'armazenamento')
    expect(search).toHaveBeenCalledOnce()
    expect(personalMemory.isEnabled()).toBe(false)
    expect(texts).toEqual([])
  })

  it('recalls a matching core fact omitted by the core character budget', async () => {
    const workspacePath = await bootMemoryLoader([
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { personalOwnerId: core-owner, personalAutomaticRecall: true, coreRecallMaxChars: 512, recallMaxChars: 2000 }',
    ])
    if (context === undefined) throw new Error('loader context was not initialized')
    const scope = { ownerId: PersonalMemoryOwnerId('core-owner') }
    const longFact = `Observatório experimental: ${'documentação local de laboratório. '.repeat(20)}`
    await context.personalMemory.create({
      scope, content: longFact, validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })
    await context.personalMemory.create({
      scope, content: 'O usuário prefere respostas compactas.', validation: 'explicit', core: true,
      source: { kind: 'session', sessionId: SessionId('core-source') },
    })

    const agent = registerAgent(context, workspacePath)
    const texts = await runPreStep(agent, 'Observatório')
    const coreText = texts.find(text => text.includes('personal-core-profile'))
    expect(coreText).toBeDefined()
    expect(coreText).toContain('respostas compactas')
    expect(coreText).not.toContain('Observatório')
    expect(coreText!.length).toBeLessThanOrEqual(512)
    const recallText = texts.find(text => text.includes('personal-memory-context'))
    expect(recallText).toContain(longFact.trim())
    expect(recallText!.length).toBeLessThanOrEqual(2000)
  })
})
