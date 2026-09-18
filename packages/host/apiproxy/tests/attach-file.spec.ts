/**
 * Browser file attachments: a non-image prompt part is persisted below
 * `<DSH_HOME>/uploads` and replaced by a text block that names the stored path,
 * so only the path — never the bytes — enters model context.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk, UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`attach-${String(nextRpc++)}`), payload }
}

/** Minimal adapter: these cases never reach provider streaming. */
class StubAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Stub' }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider: 'stub', id: 'stub-model', name: 'Stub Model' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // No provider streaming in this suite.
  }
}

let home: string | undefined
let previousHome: string | undefined

function useTemporaryHome(): string {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-attach-'))
  process.env.DSH_HOME = home
  return home
}

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
  previousHome = undefined
})

async function harness(): Promise<{ ctx: Context; agent: Agent; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  ctx.llm.registerAdapter(['stub'], new StubAdapter())
  // The image store stays unused here, but the prompt path resolves it eagerly.
  const attachments = {
    validateImage: vi.fn(),
    saveImage: vi.fn(),
    saveImages: vi.fn(() => Promise.resolve([])),
    imageLimits: { mediaTypes: ['image/png'] },
  }
  ctx.provide('attachments', Object.setPrototypeOf(attachments, AttachmentStore.prototype) as never)
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, status: 'idle', ctx, inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

describe('browser file attachments', () => {
  it('stores the bytes below DSH_HOME/uploads and names that path in model context', async () => {
    const root = useTemporaryHome()
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'stub', model: 'stub-model' }),
      cwd: '/tmp',
    })

    const body = '# Notas\n\nConteúdo do arquivo anexado.\n'
    const outcome = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text' as const, text: 'Resuma o anexo.' },
        { type: 'file' as const, name: 'notas.md', data: Buffer.from(body, 'utf8').toString('base64') },
      ],
    }))

    expect(outcome.result.ok).toBe(true)
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content).toHaveLength(2)
    expect(message.content[0]).toEqual({ type: 'text', text: 'Resuma o anexo.' })

    const pointer = message.content[1] as { type: string; text: string }
    expect(pointer.type).toBe('text')
    expect(pointer.text).toContain('[arquivo anexado]')

    // The pointer names a real file inside the uploads directory, and the bytes
    // on disk are exactly what the browser sent.
    const stored = pointer.text.replace('[arquivo anexado] ', '')
    expect(stored.startsWith(join(root, 'uploads'))).toBe(true)
    expect(readFileSync(stored, 'utf8')).toBe(body)
    expect(readdirSync(join(root, 'uploads'))).toHaveLength(1)

    // No image attachment is created for a file part.
    expect(message.content.some(block => block.type === 'image')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('keeps a hostile display name inside the uploads directory', async () => {
    const root = useTemporaryHome()
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'stub', model: 'stub-model' }),
      cwd: '/tmp',
    })

    const outcome = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{
        type: 'file' as const,
        name: '../../escape.md',
        data: Buffer.from('x', 'utf8').toString('base64'),
      }],
    }))
    expect(outcome.result.ok).toBe(true)

    const message = followup.mock.calls[0]?.[0] as UserMessage
    const pointer = message.content[0] as { text: string }
    const stored = pointer.text.replace('[arquivo anexado] ', '')
    // Stored flat inside uploads: the name keeps no separator, never starts as
    // a dotfile, and cannot address anything outside the directory.
    const entries = readdirSync(join(root, 'uploads'))
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toContain('/')
    expect(entries[0]?.startsWith('.')).toBe(false)
    expect(stored.startsWith(join(root, 'uploads'))).toBe(true)
    expect(readFileSync(stored, 'utf8')).toBe('x')
    await ctx.fiber.dispose()
  })
})
