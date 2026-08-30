import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import * as CompletionClaimPolicy from '@deepseek-ai/dsh-completion-claim-policy'
import {
  COMPLETION_EVIDENCE_UNSATISFIED,
  isStrongGlobalCompletionClaim,
  type Config,
} from '@deepseek-ai/dsh-completion-claim-policy'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

interface Harness {
  ctx: Context
}

/** Mount the real loop with tools that expose success, failure, todos, and terminal metadata. */
async function harness(
  config: Config = {},
  beforePolicy?: (ctx: Context) => void,
): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  beforePolicy?.(ctx)
  await ctx.plugin(CompletionClaimPolicy, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'completion evidence probe',
    parameters: {
      mode: { type: 'string' },
    },
    async execute(args, exec) {
      if (args.mode === 'fail') throw new HarnessError('probe failed', 'PROBE_FAILED')
      if (args.mode === 'todos') {
        exec.agent?.session.append('todo/write', {
          todos: [
            { content: 'documentar capacidades', status: 'in_progress' },
            { content: 'validar ferramentas', status: 'pending' },
          ],
        })
      }
      return [{ type: 'text', text: 'probe ok' }]
    },
  }))
  let flakyProbeCalls = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'flaky_probe',
    description: 'fails once and then succeeds for an identical operation',
    parameters: {
      ticket: { type: 'string' },
    },
    async execute() {
      flakyProbeCalls++
      if (flakyProbeCalls === 1) throw new HarnessError('transient failure', 'TRANSIENT_FAILURE')
      return [{ type: 'text', text: 'flaky probe recovered' }]
    },
  }))
  ctx.tools.register(defineTool({
    name: 'terminal_probe',
    description: 'terminal metadata probe',
    parameters: {
      exitCode: { type: 'integer', required: true },
      signal: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { type: 'integer', required: true },
          signal: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `terminal exited ${value.exitCode}` }],
      presentationMeta: (_args, value) => ({
        card: 'terminal',
        exitCode: value.exitCode,
        ...value.signal === undefined ? {} : { signal: value.signal },
      }),
    },
    async execute(args) {
      return { exitCode: args.exitCode, ...args.signal === undefined ? {} : { signal: args.signal } }
    },
  }))
  return { ctx }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
      if (current === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Start one user turn and wait until every bounded correction settles. */
async function run(ctx: Context, id: string): Promise<Agent> {
  const agent = ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'verifique tudo' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)
  return agent
}

/** Durable corrections injected by this policy. */
function recoveries(agent: Agent): SessionEvent<'user/message'>[] {
  return [...agent.session.events].filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'completion-claim-policy'
    && event.data.source.form === 'evidence-recovery')
}

describe('strong global claim classifier', () => {
  it.each([
    'Todas as ferramentas estão funcionando perfeitamente.',
    'Todas as ferramentas e habilidades funcionam corretamente.',
    'Tudo funciona.',
    'Tudo está operacional e validado.',
    'O sistema está 100% operacional.',
    'O sistema inteiro está totalmente operacional.',
    'Leon está pronto para qualquer tarefa.',
    'Everything is working perfectly.',
    'Everything works.',
    'All tools work.',
    'All tools and skills are working.',
    'All tools are fully operational.',
    'The system is fully functional.',
    'Ready for any task.',
    'Nem tudo foi automático. Todas as ferramentas estão funcionando.',
    'Not everything was automatic. All tools are working.',
  ])('recognizes %s', (text) => {
    expect(isStrongGlobalCompletionClaim(text)).toBe(true)
  })

  it.each([
    'Auditoria concluída; três itens continuam pendentes.',
    'Análise concluída com limitações conhecidas.',
    'O navegador foi validado, mas o Windows não foi testado.',
    'Analysis complete; deployment remains blocked.',
    'Nem tudo está funcionando.',
    'Not everything is working.',
    'Todas as ferramentas não estão funcionando.',
    'All tools are not operational.',
    'Não posso afirmar que tudo está funcionando.',
    'Ainda não confirmei se tudo está funcionando.',
    'O sistema não está 100% operacional.',
    'Leon is not ready for any task.',
    'Nem todas as ferramentas estão funcionando.',
    'Not all tools are working.',
    "All tools aren't working.",
    'If everything is working, finish the task.',
    'Evite dizer: tudo está funcionando.',
    'A etapa 1 está 100% concluída; ainda faltam três etapas.',
    'O navegador está totalmente operacional, mas o Windows não foi testado.',
    'Everything in the browser is working, but Windows was not tested.',
    'Todas as ferramentas têm falhas; o documento está validado.',
    'All tools have failures; the inventory report is validated.',
    'Ele escreveu: “Tudo funciona.”',
  ])('does not broaden a partial statement: %s', (text) => {
    expect(isStrongGlobalCompletionClaim(text)).toBe(false)
  })
})

describe('completion evidence recovery', () => {
  let temporaryDirectory: string | undefined
  afterEach(() => {
    if (temporaryDirectory !== undefined) rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = undefined
  })

  it('corrects the observed false claim while allowing the honest partial replacement', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const adapter = new MockAdapter([
      toolCallResponse('todos', 'probe', { mode: 'todos' }),
      textResponse('Todas as ferramentas e habilidades estão funcionando perfeitamente.'),
      textResponse('A verificação ficou parcial: uma tarefa está em andamento e outra está pendente.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'observed-claim')

    expect(adapter.requests).toHaveLength(3)
    expect(recoveries(agent)).toHaveLength(1)
    expect(recoveries(agent)[0]!.data.source).toEqual({
      kind: 'plugin',
      plugin: 'completion-claim-policy',
      form: 'evidence-recovery',
      summary: 'Completion evidence recovery 1/1',
    })
    const request = JSON.stringify(adapter.requests[2]!.messages)
    expect(request).toContain('todos pending: 1')
    expect(request).toContain('todos in_progress: 1')
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('allows an honest partial answer without current-turn tool evidence', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const adapter = new MockAdapter([
      textResponse('Auditoria concluída, mas navegador e automação Windows não foram testados.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'honest-partial')

    expect(adapter.requests).toHaveLength(1)
    expect(recoveries(agent)).toHaveLength(0)
  })

  it('accepts a failure that an identical later operation resolves', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const adapter = new MockAdapter([
      toolCallResponse('failed', 'flaky_probe', { ticket: 'same-operation' }),
      toolCallResponse('fixed', 'flaky_probe', { ticket: 'same-operation' }),
      textResponse('Tudo está funcionando e validado.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'resolved-failure')

    expect(adapter.requests).toHaveLength(3)
    expect(recoveries(agent)).toHaveLength(0)
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
  })

  it('does not let a different operation hide an earlier failure from the same tool', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const adapter = new MockAdapter([
      toolCallResponse('failed', 'probe', { mode: 'fail' }),
      toolCallResponse('different', 'probe', { mode: 'success' }),
      textResponse('Tudo está funcionando e validado.'),
      textResponse('Uma operação anterior falhou; a validação permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'different-operation')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[3]!.messages)).toContain('probe (PROBE_FAILED)')
  })

  it('reports an unresolved ToolResultBlock error', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1 })
    const adapter = new MockAdapter([
      toolCallResponse('failed', 'probe', { mode: 'fail' }),
      textResponse('Tudo está funcionando e validado.'),
      textResponse('A verificação falhou; o resultado permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'unresolved-tool-failure')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[2]!.messages)).toContain('probe (PROBE_FAILED)')
  })

  it('treats a non-zero terminal presentation as unresolved evidence', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1 })
    const adapter = new MockAdapter([
      toolCallResponse('terminal', 'terminal_probe', { exitCode: 7 }),
      textResponse('O sistema está 100% operacional.'),
      textResponse('O teste de terminal falhou com código 7; o resultado é parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'terminal-nonzero')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[2]!.messages)).toContain('terminal_probe (exitCode 7)')
  })

  it('treats a signalled terminal presentation as unresolved evidence', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1 })
    const adapter = new MockAdapter([
      toolCallResponse('terminal', 'terminal_probe', { exitCode: 0, signal: 'SIGTERM' }),
      textResponse('Everything is working perfectly.'),
      textResponse('O processo recebeu SIGTERM; a validação permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'terminal-signal')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[2]!.messages)).toContain('terminal_probe (signal SIGTERM)')
  })

  it('verifies backtick-quoted absolute artifact claims when enabled', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'dsh-completion-claim-'))
    const missing = join(temporaryDirectory, 'missing-report.md')
    const { ctx } = await harness({
      maxEvidenceRecoveries: 1,
      verifyAbsoluteArtifactClaims: true,
      requireCurrentTurnEvidence: true,
    })
    const adapter = new MockAdapter([
      toolCallResponse('probe', 'probe', { mode: 'success' }),
      textResponse(`Tudo foi concluído e validado em \`${missing}\`.`),
      textResponse('O arquivo informado não existe; a entrega permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'missing-artifact')

    expect(recoveries(agent)).toHaveLength(1)
    const block = recoveries(agent)[0]!.data.content[0]
    expect(block?.type).toBe('text')
    if (block?.type !== 'text') throw new Error('expected text recovery')
    expect(block.text).toContain(missing)
  })

  it('bounds the complete UTF-8 recovery message and marks multibyte truncation', async () => {
    const oversizedPath = `C:\\${'á'.repeat(4_000)}\\relatório.md`
    const { ctx } = await harness({
      maxEvidenceRecoveries: 1,
      maxRecoveryMessageBytes: 512,
      maxArtifactClaims: 4,
      verifyAbsoluteArtifactClaims: true,
      requireCurrentTurnEvidence: true,
    })
    const adapter = new MockAdapter([
      textResponse(`Everything works. Artefato: \`${oversizedPath}\`.`),
      textResponse('O artefato não foi comprovado; o resultado permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'bounded-multibyte-recovery')

    const block = recoveries(agent)[0]!.data.content[0]
    if (block?.type !== 'text') throw new Error('expected text recovery')
    expect(Buffer.byteLength(block.text, 'utf8')).toBeLessThanOrEqual(512)
    expect(block.text).toContain('detalhes adicionais truncados')
    expect(block.text).not.toContain('\uFFFD')
    expect(block.text).toContain('Não declare que tudo está funcionando')
  })

  it('fails closed when a claim exceeds the configured artifact-check count', async () => {
    const { ctx } = await harness({
      maxEvidenceRecoveries: 1,
      maxArtifactClaims: 1,
      verifyAbsoluteArtifactClaims: true,
      requireCurrentTurnEvidence: true,
    })
    const adapter = new MockAdapter([
      textResponse('Everything works. Artefatos: `C:\\missing-one.txt` e `C:\\missing-two.txt`.'),
      textResponse('Há artefatos sem verificação; o resultado permanece parcial.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    await run(ctx, 'artifact-claim-limit')

    const request = JSON.stringify(adapter.requests[1]!.messages)
    expect(request).toContain('quoted artifacts not found: C:\\\\missing-one.txt')
    expect(request).toContain('configured claim limit was exceeded')
  })

  it('guards an unsupported claim when current-turn evidence is required', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const adapter = new MockAdapter([
      textResponse('Everything is working perfectly.'),
      textResponse('Não executei testes neste turno; não posso confirmar a conclusão global.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'missing-current-evidence')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('no successful tool result in the current turn')
  })

  it('throws the stable HarnessError after the bounded recovery is exhausted', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1, requireCurrentTurnEvidence: true })
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => void errors.push(error))
    const adapter = new MockAdapter([
      textResponse('Everything is working perfectly.'),
      textResponse('Everything is working perfectly.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'bounded-error')

    expect(adapter.requests).toHaveLength(2)
    expect(recoveries(agent)).toHaveLength(1)
    const error = errors.find((value): value is HarnessError => value instanceof HarnessError)
    expect(error?.code).toBe(COMPLETION_EVIDENCE_UNSATISFIED)
    expect(error?.message).toBe('Strong global completion claim remains unsupported after bounded evidence recovery.')
    expect(agent.session.events.findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error' } },
    })
  })

  it('defaults to zero recoveries', async () => {
    const { ctx } = await harness({ requireCurrentTurnEvidence: true })
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => void errors.push(error))
    const adapter = new MockAdapter([
      textResponse('Everything is working perfectly.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'zero-recoveries-default')

    expect(adapter.requests).toHaveLength(1)
    expect(recoveries(agent)).toHaveLength(0)
    const error = errors.find((value): value is HarnessError => value instanceof HarnessError)
    expect(error?.code).toBe(COMPLETION_EVIDENCE_UNSATISFIED)
  })

  it('rejects invalid limits through the real loader export', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await expect(ctx.plugin(CompletionClaimPolicy, { maxEvidenceRecoveries: -1 }))
      .rejects.toThrow(/expected number >= 0|integer between 0 and 3/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxEvidenceRecoveries: 1.5 }))
      .rejects.toThrow(/expected number multiple of 1|integer between 0 and 3/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxEvidenceRecoveries: 4 }))
      .rejects.toThrow(/expected number <= 3|integer between 0 and 3/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxRecoveryMessageBytes: 511 }))
      .rejects.toThrow(/expected number >= 512|integer between 512 and 65536/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxRecoveryMessageBytes: 512.5 }))
      .rejects.toThrow(/expected number multiple of 1|integer between 512 and 65536/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxRecoveryMessageBytes: 65_537 }))
      .rejects.toThrow(/expected number <= 65536|integer between 512 and 65536/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxArtifactClaims: 0 }))
      .rejects.toThrow(/expected number >= 1|integer between 1 and 256/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxArtifactClaims: 1.5 }))
      .rejects.toThrow(/expected number multiple of 1|integer between 1 and 256/)
    await expect(ctx.plugin(CompletionClaimPolicy, { maxArtifactClaims: 257 }))
      .rejects.toThrow(/expected number <= 256|integer between 1 and 256/)

    expect('default' in CompletionClaimPolicy).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(CompletionClaimPolicy) as Record<string, unknown>
    expect(unwrapped).toBe(CompletionClaimPolicy)
    expect(unwrapped.name).toBe('completion-claim-policy')
  })

  it('reports a model call that has no matching durable result', async () => {
    const { ctx } = await harness({ maxEvidenceRecoveries: 1 }, (inner) => {
      inner.on('agent/turn-stopping', ({ agent, turn }) => {
        if (agent.session.events.some(event => event.type === 'tool/call' && String(event.data.callId) === 'orphan')) return
        const step = agent.session.events.findLast(event => event.type === 'step/start')?.data.step ?? 1
        agent.session.append('tool/call', {
          turn,
          step,
          callId: CallId('orphan'),
          name: 'unsettled_probe',
          arguments: '{}',
        })
      })
    })
    const adapter = new MockAdapter([
      textResponse('All tools are working and validated.'),
      textResponse('Uma chamada não produziu resultado; a validação está incompleta.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await run(ctx, 'orphan-call')

    expect(recoveries(agent)).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('unsettled_probe')
  })
})
