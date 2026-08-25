import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { memoryCandidateDomainSpec, type MemoryCandidateRecord } from '../src/spec.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
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

describe('memory shadow extraction through a real Loader composition', () => {
  it('boots cordis.yml and persists only a review candidate', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-shadow-loader-'))
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
      "- name: '@deepseek-ai/dsh-tool-memory'",
      '  config: { shadowExtraction: true, shadowOwnerId: loader-owner }',
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
})
