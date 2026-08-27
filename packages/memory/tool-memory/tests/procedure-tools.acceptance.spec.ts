import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ProcedureLearningService from '../src/procedure-learning.ts'
import { ProcedureId } from '../src/procedure-contracts.ts'
import { procedureLearningDomainSpec } from '../src/spec.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Mount the real durable services, tool registry, and agent loop used by Leon. */
async function harness(adapter: MockAdapter) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-procedure-tools-')))
  tempDirs.push(cwd)
  const ctx = new Context()
  contexts.push(ctx)
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
  await ctx.plugin(ProcedureLearningService, { reviewedBy: 'leon-local-human' })
  await ctx.plugin(ToolMemory, {})
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, cwd, workspace }
}

/** Recover a procedure id only from a compact successful procedure-tool result. */
function procedureIdFrom(options: GenerateOptions): string {
  for (const message of [...options.messages].reverse()) {
    for (const block of [...message.content].reverse()) {
      if (block.type !== 'tool-result') continue
      for (const content of block.content) {
        if (content.type !== 'text') continue
        try {
          const parsed = JSON.parse(content.text) as { id?: unknown }
          if (typeof parsed.id === 'string') return parsed.id
        } catch {
          // Non-JSON tool errors and fixture text are not procedure records.
        }
      }
    }
  }
  throw new Error('expected a prior procedure result carrying an id')
}

/** Find one exact durable tool result in an agent session. */
function resultFor(events: readonly SessionEvent[], callId: string) {
  const event = events.find(item => item.type === 'tool/result' && item.data.message.source.callId === callId)
  if (event?.type !== 'tool/result') throw new Error(`missing tool result ${callId}`)
  return event
}

/** Parse the compact JSON rendered by a successful procedure tool. */
function resultJson(events: readonly SessionEvent[], callId: string): Record<string, unknown> {
  const block = resultFor(events, callId).data.message.content[0]
  const text = block.content.find(content => content.type === 'text')
  if (text?.type !== 'text') throw new Error(`tool result ${callId} has no text block`)
  try {
    return JSON.parse(text.text) as Record<string, unknown>
  } catch {
    throw new Error(`tool result ${callId} is not JSON: ${text.text}`)
  }
}

describe('LEON-ACC-005 procedure tools', () => {
  it('learns reviewed successful tool evidence and reuses exact steps after a model switch', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('prepare-workspace', 'fixture_workspace_step', {
        action: 'prepare',
        target: 'workspace',
      }),
      toolCallResponse('verify-workspace', 'fixture_workspace_verify', {
        check: 'workspace-ready',
      }),
      toolCallResponse('propose-procedure', 'procedure_propose', {
        title: 'Preparar workspace validado',
        trigger: 'preparar workspace com verificação independente',
        execution_call_ids: ['prepare-workspace'],
        verification_call_id: 'verify-workspace',
        revalidate_days: 30,
        valid_days: 90,
      }),
      options => toolCallResponse('inspect-candidate', 'procedure_inspect', {
        procedure_id: procedureIdFrom(options),
      }),
      options => toolCallResponse('unauthorized-review', 'procedure_review', {
        procedure_id: procedureIdFrom(options),
        revision: 1,
        decision: 'accept',
      }),
      textResponse('Aguardando autorização humana específica.'),
      options => toolCallResponse('authorized-review', 'procedure_review', {
        procedure_id: procedureIdFrom(options),
        revision: 1,
        decision: 'accept',
      }),
      textResponse('Procedimento aprovado pela autorização direta.'),
      toolCallResponse('search-procedure', 'procedure_search', {
        query: 'preparar workspace com verificação',
        limit: 4,
      }),
      toolCallResponse('reuse-prepare-workspace', 'fixture_workspace_step', {
        action: 'prepare',
        target: 'workspace',
      }),
      toolCallResponse('reuse-verify-workspace', 'fixture_workspace_verify', {
        check: 'workspace-ready',
      }),
      textResponse('Procedimento recuperado após a troca de modelo.'),
    ])
    const { ctx, cwd, workspace } = await harness(adapter)
    const invocations: Array<{ tool: string; arguments: Record<string, string> }> = []
    ctx.tools.register(defineContentToolFixture({
      name: 'fixture_workspace_step',
      description: 'Perform one deterministic workspace preparation fixture.',
      parameters: {
        action: { type: 'string', required: true },
        target: { type: 'string', required: true },
      },
      async execute(args) {
        invocations.push({ tool: 'fixture_workspace_step', arguments: { ...args } })
        return [{ type: 'text', text: 'workspace prepared' }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'fixture_workspace_verify',
      description: 'Verify the deterministic workspace preparation fixture.',
      parameters: { check: { type: 'string', required: true } },
      async execute(args) {
        invocations.push({ tool: 'fixture_workspace_verify', arguments: { ...args } })
        return [{ type: 'text', text: 'workspace ready' }]
      },
    }))

    const sessionCwd = `${cwd}${sep}`
    const teaching = ctx.agentLoop.create(
      SessionId('leon-procedure-tool-teaching'),
      { provider: 'mock', model: 'qwen3.8:9b-q8' },
      { cwd: sessionCwd },
    )
    teaching.followup(createUserMessage({
      content: [{ type: 'text', text: 'Aprenda este procedimento, mostre o candidato e aguarde minha aprovação.' }],
      source: { kind: 'user' },
    }))
    await teaching.whenIdle()

    expect(invocations).toEqual([
      {
        tool: 'fixture_workspace_step',
        arguments: { action: 'prepare', target: 'workspace' },
      },
      {
        tool: 'fixture_workspace_verify',
        arguments: { check: 'workspace-ready' },
      },
    ])
    expect(resultFor(teaching.session.events, 'prepare-workspace').data.message.content[0].isError).toBe(false)
    expect(resultFor(teaching.session.events, 'verify-workspace').data.message.content[0].isError).toBe(false)

    const proposed = resultJson(teaching.session.events, 'propose-procedure')
    expect(proposed).toMatchObject({ revision: 1, status: 'candidate' })
    const procedureId = String(proposed.id)
    const inspected = resultJson(teaching.session.events, 'inspect-candidate')
    expect(inspected).toMatchObject({
      id: procedureId,
      revision: 1,
      status: 'candidate',
      steps: [{
        tool: 'fixture_workspace_step',
        arguments: { action: 'prepare', target: 'workspace' },
      }],
      verifier: {
        tool: 'fixture_workspace_verify',
        arguments: { check: 'workspace-ready' },
      },
    })
    expect(Array.isArray(inspected.preconditions)
      && inspected.preconditions.some(item => JSON.stringify(item) === JSON.stringify({
        key: 'cwd',
        expected: workspace.path,
      }))).toBe(true)
    expect(sessionCwd).not.toBe(workspace.path)

    const unauthorized = resultFor(teaching.session.events, 'unauthorized-review')
    expect(unauthorized.data.message.content[0].isError).toBe(true)
    expect(unauthorized.data.error).toMatchObject({ code: 'PROCEDURE_REVIEW_AUTHORITY_REQUIRED' })
    const learnedId = ProcedureId(procedureId)
    expect(ctx.procedureLearning.inspect({ workspaceId: workspace.id, id: learnedId }))
      .toMatchObject({ ok: true, value: { revision: 1, status: 'candidate' } })

    teaching.followup(createUserMessage({
      content: [{ type: 'text', text: `/procedure-review ${procedureId} 1 accept` }],
      source: { kind: 'user' },
    }))
    await teaching.whenIdle()
    expect(resultJson(teaching.session.events, 'authorized-review'))
      .toMatchObject({ id: procedureId, revision: 2, status: 'validated' })

    const stored = ctx.storageDomain.get(procedureLearningDomainSpec.name)
      ?.table('procedures').get(learnedId)
    expect(stored).toMatchObject({
      id: procedureId,
      workspaceId: workspace.id,
      revision: 2,
      status: 'validated',
      reviewedBy: 'leon-local-human',
      evidence: [{
        kind: 'initial-validation',
        sessionId: teaching.session.header.id,
        executionCallIds: ['prepare-workspace'],
        verificationCallId: 'verify-workspace',
        resultDigests: [expect.stringMatching(/^[a-f\d]{64}$/u), expect.stringMatching(/^[a-f\d]{64}$/u)],
        succeeded: true,
      }],
    })

    const reuse = ctx.agentLoop.create(
      SessionId('leon-procedure-tool-reuse'),
      { provider: 'mock', model: 'ornith-1.5:9b' },
      { cwd: sessionCwd },
    )
    reuse.followup(createUserMessage({
      content: [{ type: 'text', text: 'Recupere o procedimento aprovado para preparar o workspace.' }],
      source: { kind: 'user' },
    }))
    await reuse.whenIdle()

    expect(adapter.requests.map(request => request.model)).toEqual([
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'qwen3.8:9b-q8',
      'ornith-1.5:9b',
      'ornith-1.5:9b',
      'ornith-1.5:9b',
      'ornith-1.5:9b',
    ])
    expect(resultJson(reuse.session.events, 'search-procedure')).toMatchObject({
      procedures: [{
        id: procedureId,
        revision: 2,
        title: 'Preparar workspace validado',
        trigger: 'preparar workspace com verificação independente',
        steps: [{
          tool: 'fixture_workspace_step',
          arguments: { action: 'prepare', target: 'workspace' },
        }],
        verifier: {
          tool: 'fixture_workspace_verify',
          arguments: { check: 'workspace-ready' },
        },
      }],
      blocked: [],
    })
    expect(invocations).toEqual([
      { tool: 'fixture_workspace_step', arguments: { action: 'prepare', target: 'workspace' } },
      { tool: 'fixture_workspace_verify', arguments: { check: 'workspace-ready' } },
      { tool: 'fixture_workspace_step', arguments: { action: 'prepare', target: 'workspace' } },
      { tool: 'fixture_workspace_verify', arguments: { check: 'workspace-ready' } },
    ])
    expect(resultFor(reuse.session.events, 'reuse-prepare-workspace').data.message.content[0].isError).toBe(false)
    expect(resultFor(reuse.session.events, 'reuse-verify-workspace').data.message.content[0].isError).toBe(false)
  })

  it('rejects an ambiguous repeated call id instead of learning the wrong trajectory', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('repeated-call', 'fixture_ambiguous_step', { value: 'first' }),
      textResponse('Primeira execução encerrada.'),
      toolCallResponse('repeated-call', 'fixture_ambiguous_step', { value: 'second' }),
      toolCallResponse('distinct-verifier', 'fixture_ambiguous_verify', { check: 'ready' }),
      toolCallResponse('propose-ambiguous', 'procedure_propose', {
        title: 'Candidato ambíguo',
        trigger: 'não deve ser persistido',
        execution_call_ids: ['repeated-call'],
        verification_call_id: 'distinct-verifier',
        revalidate_days: 30,
        valid_days: 90,
      }),
      textResponse('Candidato rejeitado.'),
    ])
    const { ctx, cwd } = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'fixture_ambiguous_step',
      description: 'Fixture whose call id is deliberately repeated.',
      parameters: { value: { type: 'string', required: true } },
      async execute(args) {
        return [{ type: 'text', text: args.value }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'fixture_ambiguous_verify',
      description: 'Independent verifier for the ambiguous-call fixture.',
      parameters: { check: { type: 'string', required: true } },
      async execute(args) {
        return [{ type: 'text', text: args.check }]
      },
    }))
    const agent = ctx.agentLoop.create(
      SessionId('leon-procedure-ambiguous-call'),
      { provider: 'mock', model: 'qwen3.8:9b-q8' },
      { cwd },
    )
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Execute a primeira amostra.' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Repita e tente aprender.' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    const rejected = resultFor(agent.session.events, 'propose-ambiguous')
    expect(rejected.data.message.content[0].isError).toBe(true)
    expect(rejected.data.error).toMatchObject({ code: 'PROCEDURE_CALL_AMBIGUOUS' })
    expect(ctx.storageDomain.get(procedureLearningDomainSpec.name)?.table('procedures').size).toBe(0)
  })
})
