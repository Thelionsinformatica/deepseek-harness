/** Keyless routing through the production Loader, gateway and agent loop; only the provider is synthetic. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import ApiProxyService from '../src/index.ts'
import { RpcId, type RpcResponse } from '../src/api/rpc.ts'

let context: Context | undefined
let root: string | undefined
let nextRpc = 0

class RecordingAdapter extends LlmAdapter {
  readonly requested: string[] = []

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(['fast', 'main', 'expert'].map(id => ({ provider, id, name: id })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (!['fast', 'main', 'expert'].includes(model)) {
      return Promise.reject(new LlmError(`Unknown isolated model ${model}`, 'UNKNOWN_MODEL'))
    }
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requested.push(options.model)
    const text = `route:${options.model}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function request<P>(payload: P) {
  return { rpcId: RpcId(`mode-loader-${String(++nextRpc)}`), payload }
}

function value<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(expert = 'expert') {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-model-modes-'))
  root = cwd
  const path = join(cwd, 'cordis.yml')
  await writeFile(path, [
    '- name: session', '- name: agent', '- name: system-prompt', '- name: tools',
    '- name: llm', '- name: questions', '- name: fixture-unused-capabilities',
    '- name: default-model',
    '  config: { provider: isolated, model: main }',
    '- name: loop', '- name: gateway',
    '  config:',
    '    nativeOpen: false',
    '    adaptiveRouting:',
    '      coordinatorMode: true',
    '      provider: isolated',
    '      fastModel: fast',
    '      mainModel: main',
    `      expertModel: ${expert}`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(cwd).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const unusedCapabilities = {
    name: 'fixture-unused-capabilities',
    apply(ctx: Context) {
      // These unrelated seams are never addressed by this text-only routing scenario.
      for (const capability of ['attachments', 'directoryPicker', 'subagents', 'sessionQuery', 'workspaceRegistry']) {
        ctx.provide(capability, {})
      }
    },
  }
  const modules = new Map<string, unknown>([
    ['session', SessionStore], ['agent', AgentRegistry], ['system-prompt', SystemPrompt],
    ['tools', ToolRuntime], ['llm', LlmRuntime], ['questions', UserQuestions],
    ['default-model', AgentDefaultModelConfig], ['loop', AgentLoop], ['gateway', ApiProxyService],
    ['fixture-unused-capabilities', unusedCapabilities],
  ])
  context.loader.internal = {
    version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await context.loader.await()
  const adapter = new RecordingAdapter()
  context.llm.registerAdapter(['isolated'], adapter)
  expect(context.get('apiProxy')).toBeDefined()
  return { ctx: context, adapter, cwd }
}

describe('model modes real Loader composition', () => {
  it('keeps manual, adaptive and team choices distinct in real logged requests', async () => {
    const { ctx, adapter, cwd } = await boot()
    const savePrincipal = vi.spyOn(ctx.agentDefaultModel, 'saveSelection')
    const sessionId = SessionId('isolated-modes-loader')
    value(await ctx.apiProxy.sessions.create(request({ sessionId, cwd })))
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Gateway did not create the agent')
    for (const [selectionMode, model, text, expected] of [
      ['manual', 'fast', 'Faça uma auditoria completa.', 'fast'],
      ['adaptive', 'main', 'Oi', 'fast'],
      ['adaptive', 'main', 'Corrija o arquivo de código.', 'main'],
      ['adaptive', 'main', 'Faça uma auditoria completa.', 'expert'],
      ['team', 'expert', 'Faça uma auditoria completa.', 'main'],
    ] as const) {
      value(await ctx.apiProxy.sessions.selectModel(request({ sessionId, provider: 'isolated', model, selectionMode })))
      value(await ctx.apiProxy.sessions.prompt(request({
        sessionId, mode: 'queue', content: [{ type: 'text', text }],
      })))
      await agent.whenIdle()
      expect(adapter.requested.at(-1)).toBe(expected)
      expect(agent.session.requestHeader()?.config.model).toBe(expected)
      expect(agent.session.deriveMessages().at(-1)).toMatchObject({
        role: 'assistant', content: [{ type: 'text', text: `route:${expected}` }],
      })
    }
    expect(adapter.requested).toEqual(['fast', 'fast', 'main', 'expert', 'main'])
    expect(ctx.agents.list()).toHaveLength(1)
    expect(savePrincipal).not.toHaveBeenCalled()
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'isolated', model: 'main' })
    expect(value(await ctx.apiProxy.sessions.models(request({ sessionId })))).toMatchObject({
      selectionMode: 'team', current: { provider: 'isolated', model: 'main' },
    })
  })

  it('blocks an unavailable tier without sending the prompt to the previous route', async () => {
    const { ctx, adapter, cwd } = await boot('missing-expert')
    const sessionId = SessionId('isolated-unavailable-loader')
    value(await ctx.apiProxy.sessions.create(request({ sessionId, cwd })))
    value(await ctx.apiProxy.sessions.selectModel(request({
      sessionId, provider: 'isolated', model: 'main', selectionMode: 'adaptive',
    })))
    const response = await ctx.apiProxy.sessions.prompt(request({
      sessionId, mode: 'queue', content: [{ type: 'text', text: 'Faça uma auditoria completa.' }],
    }))
    expect(response.result).toMatchObject({ ok: false, error: { details: { reason: 'ADAPTIVE_ROUTE_UNAVAILABLE' } } })
    expect(adapter.requested).toEqual([])
    expect(ctx.sessions.get(sessionId)?.events.some(event => event.type === 'user/message')).toBe(false)
  })
})
