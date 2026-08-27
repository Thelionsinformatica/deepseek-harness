import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  ProcedureLearningService,
  type ProcedureToolObservation,
  type ProcedureValidity,
} from '@deepseek-ai/dsh-tool-memory'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const contexts: Context[] = []
const workspaceId = WorkspaceId('leon-acc-005-workspace')
const otherWorkspaceId = WorkspaceId('leon-acc-005-other-workspace')
const sourceSessionId = SessionId('leon-acc-005-source-session')

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.useRealTimers()
})

async function harness(pool = new MemoryMediaPool()): Promise<{ ctx: Context; pool: MemoryMediaPool }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(ProcedureLearningService, { reviewedBy: 'leon-local-reviewer' })
  return { ctx, pool }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function observation(
  callId: string,
  tool: string,
  args: ProcedureToolObservation['arguments'],
  observedAt: string,
  succeeded = true,
  sessionId = sourceSessionId,
): ProcedureToolObservation {
  return {
    sessionId,
    callId: CallId(callId),
    tool,
    arguments: args,
    succeeded,
    resultDigest: digest(`${callId}:${succeeded ? 'ok' : 'failed'}`),
    observedAt,
  }
}

function validity(revalidateAfter: string, validUntil: string): ProcedureValidity {
  return { revalidateAfter, validUntil }
}

function successfulProposal() {
  return {
    workspaceId,
    title: 'Preparar workspace Node',
    trigger: 'preparar workspace Node com dependências e migrações verificadas',
    preconditions: [
      { key: 'os', expected: 'windows' },
      { key: 'packageManager', expected: 'pnpm' },
    ],
    executions: [
      observation(
        'install-dependencies',
        'shell_run',
        { command: 'pnpm install', cwd: 'E:\\Computador\\projeto' },
        '2026-08-26T11:58:00.000Z',
      ),
      observation(
        'run-migrations',
        'shell_run',
        { command: 'pnpm migrate', cwd: 'E:\\Computador\\projeto' },
        '2026-08-26T11:59:00.000Z',
      ),
    ],
    verification: observation(
      'verify-tests',
      'test_runner',
      { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' },
      '2026-08-26T12:00:00.000Z',
    ),
    validity: validity('2026-09-25T12:00:00.000Z', '2026-11-24T12:00:00.000Z'),
  } as const
}

describe('LEON-ACC-005 structured procedure learning', () => {
  it('rejects failed trajectories and credential-like procedure content before persistence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    const { ctx } = await harness()
    const proposal = successfulProposal()

    const failed = await ctx.procedureLearning.propose({
      ...proposal,
      executions: [
        ...proposal.executions,
        observation(
          'failed-build',
          'shell_run',
          { command: 'pnpm build' },
          '2026-08-26T11:59:30.000Z',
          false,
        ),
      ],
    })
    expect(failed).toEqual({
      ok: false,
      error: { code: 'procedure-invalid-proposal', reason: 'trajectory-not-successful' },
    })

    const sensitive = await ctx.procedureLearning.propose({
      ...proposal,
      trigger: 'Use a senha: sk-proj-1234567890abcdefghijklmnop para preparar o workspace.',
    })
    expect(sensitive).toEqual({ ok: false, error: { code: 'procedure-sensitive-content' } })
    expect(ctx.storageDomain.get('procedure_learning')?.table('procedures').size).toBe(0)
  })

  it('promotes only after review, survives a service restart, and reuses exact steps only with matching preconditions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    const first = await harness()
    const proposed = await first.ctx.procedureLearning.propose(successfulProposal())
    if (!proposed.ok) throw new Error(`proposal failed: ${proposed.error.code}`)

    expect(proposed.value).toMatchObject({
      revision: 1,
      status: 'candidate',
      evidence: [{
        kind: 'initial-validation',
        sessionId: sourceSessionId,
        executionCallIds: [CallId('install-dependencies'), CallId('run-migrations')],
        verificationCallId: CallId('verify-tests'),
        succeeded: true,
      }],
    })
    expect(first.ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })).toEqual({ items: [], blocked: [] })

    const [reviewed, conflictingReview] = await Promise.all([
      first.ctx.procedureLearning.review({
        workspaceId,
        id: proposed.value.id,
        expectedRevision: 1,
        decision: 'accept',
      }),
      first.ctx.procedureLearning.review({
        workspaceId,
        id: proposed.value.id,
        expectedRevision: 1,
        decision: 'reject',
      }),
    ])
    expect(reviewed).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        status: 'validated',
        reviewedBy: 'leon-local-reviewer',
      },
    })
    expect(conflictingReview).toEqual({
      ok: false,
      error: {
        code: 'procedure-revision-conflict',
        id: proposed.value.id,
        currentRevision: 2,
      },
    })

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const second = await harness(first.pool)
    const reused = second.ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })
    expect(reused.blocked).toEqual([])
    expect(reused.items).toHaveLength(1)
    expect(reused.items[0]).toMatchObject({
      id: proposed.value.id,
      revision: 2,
      steps: [
        { tool: 'shell_run', arguments: { command: 'pnpm install', cwd: 'E:\\Computador\\projeto' } },
        { tool: 'shell_run', arguments: { command: 'pnpm migrate', cwd: 'E:\\Computador\\projeto' } },
      ],
      verifier: {
        tool: 'test_runner',
        arguments: { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' },
      },
    })
    expect(JSON.stringify(reused.items[0])).not.toContain('failed-build')

    expect(second.ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'linux', packageManager: 'pnpm' },
    })).toEqual({
      items: [],
      blocked: [{
        id: proposed.value.id,
        revision: 2,
        reason: 'precondition-mismatch',
        verifier: { tool: 'test_runner', arguments: { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' } },
      }],
    })
    expect(second.ctx.procedureLearning.findReusable({
      workspaceId: otherWorkspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })).toEqual({ items: [], blocked: [] })
  })

  it('withholds procedures when revalidation is due, marks a failed check stale, and reactivates only after a successful check', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    const { ctx } = await harness()
    const proposed = await ctx.procedureLearning.propose(successfulProposal())
    if (!proposed.ok) throw new Error(`proposal failed: ${proposed.error.code}`)
    const reviewed = await ctx.procedureLearning.review({
      workspaceId,
      id: proposed.value.id,
      expectedRevision: 1,
      decision: 'accept',
    })
    if (!reviewed.ok) throw new Error(`review failed: ${reviewed.error.code}`)

    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'))
    expect(ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })).toEqual({
      items: [],
      blocked: [{
        id: proposed.value.id,
        revision: 2,
        reason: 'revalidation-required',
        verifier: { tool: 'test_runner', arguments: { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' } },
      }],
    })

    const failed = await ctx.procedureLearning.revalidate({
      workspaceId,
      id: proposed.value.id,
      expectedRevision: 2,
      preconditions: { os: 'windows', packageManager: 'pnpm' },
      verification: observation(
        'verify-tests-failed',
        'test_runner',
        { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' },
        '2026-09-25T12:00:00.000Z',
        false,
        SessionId('leon-acc-005-revalidation-session'),
      ),
    })
    expect(failed).toMatchObject({
      ok: true,
      value: {
        revision: 3,
        status: 'stale',
        evidence: [
          { kind: 'initial-validation', succeeded: true },
          { kind: 'revalidation', succeeded: false },
        ],
      },
    })
    expect(ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })).toEqual({
      items: [],
      blocked: [{
        id: proposed.value.id,
        revision: 3,
        reason: 'stale',
        verifier: { tool: 'test_runner', arguments: { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' } },
      }],
    })

    vi.setSystemTime(new Date('2026-09-26T12:00:00.000Z'))
    const reactivated = await ctx.procedureLearning.revalidate({
      workspaceId,
      id: proposed.value.id,
      expectedRevision: 3,
      preconditions: { os: 'windows', packageManager: 'pnpm' },
      verification: observation(
        'verify-tests-recovered',
        'test_runner',
        { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' },
        '2026-09-26T12:00:00.000Z',
        true,
        SessionId('leon-acc-005-recovery-session'),
      ),
      validity: validity('2026-10-26T12:00:00.000Z', '2026-12-25T12:00:00.000Z'),
    })
    expect(reactivated).toMatchObject({
      ok: true,
      value: { revision: 4, status: 'validated', lastValidatedAt: '2026-09-26T12:00:00.000Z' },
    })
    expect(ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    }).items).toHaveLength(1)

    vi.setSystemTime(new Date('2026-12-25T12:00:00.000Z'))
    expect(ctx.procedureLearning.findReusable({
      workspaceId,
      query: 'preparar workspace Node',
      preconditions: { os: 'windows', packageManager: 'pnpm' },
    })).toEqual({
      items: [],
      blocked: [{
        id: proposed.value.id,
        revision: 4,
        reason: 'expired',
        verifier: { tool: 'test_runner', arguments: { command: 'pnpm test', cwd: 'E:\\Computador\\projeto' } },
      }],
    })
  })
})
