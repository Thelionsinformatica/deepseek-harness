import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryRuntime from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const DAY_MS = 86_400_000
const DECISION = 'A decisão do projeto Atlas sobre backup é usar a unidade E toda sexta-feira.'
const tempDirs: string[] = []

interface RecallEnvelope {
  readonly memories: readonly {
    readonly revision: number
    readonly value: string
    readonly source: { readonly sessionId: string }
  }[]
}

afterEach(async () => {
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function createHarness(adapter: MockAdapter) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'leon-acceptance-old-decision-')))
  tempDirs.push(cwd)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
    listSnapshots: () => Promise.resolve([]),
    load: () => Promise.reject(new Error('not used')),
    inspect: () => Promise.reject(new Error('not used')),
  } as never)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkspaceRegistry)
  const workspace = await ctx.workspaceRegistry.create(cwd)
  await ctx.plugin(MemoryRuntime, { provider: 'local' })
  await ctx.plugin(MemoryLocal)
  await ctx.plugin(ToolMemory, {
    automaticRecall: true,
    recallLimit: 4,
    recallMaxChars: 4_000,
    ranking: {
      enabled: true,
      halfLifeDays: 30,
      relevanceWeight: 0.55,
      recencyWeight: 0.2,
      importanceWeight: 0.15,
      validationWeight: 0.1,
    },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, cwd, workspace }
}

function recallEnvelope(agent: Agent): RecallEnvelope {
  const snapshot = agent.session.events.find(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'tool-memory')
  if (snapshot?.type !== 'user/message') throw new Error('expected one automatic memory snapshot')
  const block = snapshot.data.content.find(item => item.type === 'text')
  if (block?.type !== 'text') throw new Error('expected snapshot text')
  const jsonStart = block.text.indexOf('{')
  if (jsonStart < 0) throw new Error('expected snapshot JSON envelope')
  return JSON.parse(block.text.slice(jsonStart)) as RecallEnvelope
}

describe('LEON-ACC-002 long-horizon decision recall', () => {
  it('recovers the correct 150-day-old decision ahead of recent distractors in a new session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const recordedAt = Date.parse('2026-01-01T12:00:00.000Z')
    const recallAt = recordedAt + 150 * DAY_MS
    vi.setSystemTime(recordedAt)

    const adapter = new MockAdapter([
      toolCallResponse('remember-atlas-decision', 'memory_remember', { content: DECISION }),
      textResponse('Decisão registrada.'),
      textResponse('A decisão era usar a unidade E toda sexta-feira.'),
    ])
    const { ctx, cwd, workspace } = await createHarness(adapter)
    try {
      const source = ctx.agentLoop.create(
        SessionId('leon-acceptance-old-decision-source'),
        { provider: 'mock', model: 'mock' },
        { cwd },
      )
      source.followup(createUserMessage({
        content: [{ type: 'text', text: 'Leon, registre a decisão confirmada do projeto Atlas.' }],
        source: { kind: 'user' },
      }))
      await source.whenIdle()

      const [storedDecision] = await ctx.memory.search({
        scope: { workspaceId: workspace.id },
        query: 'decisão projeto Atlas backup unidade E',
        limit: 8,
      })
      expect(storedDecision?.record).toMatchObject({
        content: DECISION,
        revision: 1,
        validation: 'explicit',
        source: { kind: 'session', sessionId: source.session.header.id },
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      })
      if (storedDecision === undefined) throw new Error('expected the old decision to be stored')

      vi.setSystemTime(recallAt - DAY_MS)
      for (const content of [
        'O projeto Atlas mantém relatórios mensais de auditoria.',
        'O backup do projeto Boreal usa armazenamento local.',
        'A decisão do projeto Delta sobre backup é usar a nuvem.',
        'O projeto Atlas usa a unidade E para arquivos temporários.',
        'A equipe revisa a política de backup mensalmente.',
        'O projeto Atlas testa restauração em laboratório.',
      ]) {
        await ctx.memory.create({
          scope: { workspaceId: workspace.id },
          content,
          source: { kind: 'session', sessionId: SessionId('recent-distractors') },
        })
      }
      await ctx.memory.create({
        scope: { workspaceId: workspace.id },
        content: 'A decisão do projeto Atlas sobre backup é usar uma unidade temporária.',
        source: { kind: 'session', sessionId: SessionId('expired-distractor') },
        validFrom: new Date(recallAt - 2 * DAY_MS).toISOString(),
        expiresAt: new Date(recallAt - DAY_MS / 2).toISOString(),
      })
      const superseded = await ctx.memory.create({
        scope: { workspaceId: workspace.id },
        content: 'A decisão do projeto Atlas sobre backup é usar a unidade Z.',
        source: { kind: 'session', sessionId: SessionId('superseded-distractor') },
      })
      vi.setSystemTime(recallAt - DAY_MS + 3_600_000)
      await ctx.memory.update({
        scope: { workspaceId: workspace.id },
        ref: { id: superseded.id, revision: superseded.revision },
        content: 'A decisão do projeto Atlas sobre retenção temporária foi cancelada.',
      })

      const otherCwd = await realpath(await mkdtemp(join(tmpdir(), 'leon-acceptance-other-workspace-')))
      tempDirs.push(otherCwd)
      const otherWorkspace = await ctx.workspaceRegistry.create(otherCwd)
      await ctx.memory.create({
        scope: { workspaceId: otherWorkspace.id },
        content: 'A decisão do projeto Atlas sobre backup é usar a unidade X.',
        source: { kind: 'session', sessionId: SessionId('cross-workspace-distractor') },
      })

      vi.setSystemTime(recallAt)
      const target = ctx.agentLoop.create(
        SessionId('leon-acceptance-old-decision-target'),
        { provider: 'mock', model: 'mock' },
        { cwd },
      )
      target.followup(createUserMessage({
        content: [{ type: 'text', text: 'Qual foi a decisão do projeto Atlas sobre backup?' }],
        source: { kind: 'user' },
      }))
      await target.whenIdle()

      const recalled = recallEnvelope(target).memories
      expect(recalled[0]).toMatchObject({
        revision: 1,
        value: DECISION,
        source: { sessionId: source.session.header.id },
      })
      expect(recalled).toHaveLength(4)
      expect(recallAt - Date.parse(storedDecision.record.updatedAt)).toBe(150 * DAY_MS)
      const serialized = JSON.stringify(recalled)
      expect(serialized).not.toContain('unidade temporária')
      expect(serialized).not.toContain('unidade Z')
      expect(serialized).not.toContain('unidade X')
      expect(source.session.header.id).not.toBe(target.session.header.id)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
