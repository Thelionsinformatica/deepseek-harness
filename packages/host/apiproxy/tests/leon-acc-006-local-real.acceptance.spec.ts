import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chooseAdaptiveModel } from '../src/adaptive-model.ts'
import {
  dispatchThroughLeonAcc006Sentinel,
  leonAcc006RoutingConfig,
} from './leon-acc-006-routing-policy.fixture.ts'
import {
  leonAcc006LocalTasks,
  normalizeLeonAcc006Answer,
  type LeonAcc006LocalTask,
} from './leon-acc-006-local-real.fixture.ts'

const RUN_REAL_BENCHMARK = process.env.LEON_ACC_006_REAL === '1'
const realDescribe = RUN_REAL_BENCHMARK ? describe : describe.skip
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const TASK_TIMEOUT_MS = 120_000

interface OllamaChatResponse {
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
}

interface TaskEvidence {
  id: string
  provider: 'ollama'
  model: string
  tier: string
  passed: boolean
  latencyMs: number
  answerSha256: string
  inputTokens: number
  outputTokens: number
  errorCode?: string
}

/** Permit only a literal loopback HTTP endpoint; this benchmark owns no external client. */
export function loopbackOllamaUrl(raw: string): URL {
  const url = new URL(raw)
  const loopbackHosts = new Set(['127.0.0.1', '[::1]'])
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    throw new Error(`LEON-ACC-006_NON_LOOPBACK_ENDPOINT: ${url.origin}`)
  }
  return url
}

/** Extract the one JSON answer requested through Ollama structured output. */
function answerFrom(content: string): string {
  const stripped = content.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
  const parsed: unknown = JSON.parse(stripped)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LEON-ACC-006_INVALID_STRUCTURED_ANSWER')
  }
  const answer = (parsed as { answer?: unknown }).answer
  if (typeof answer !== 'string' && typeof answer !== 'number' && typeof answer !== 'boolean') {
    throw new Error('LEON-ACC-006_INVALID_STRUCTURED_ANSWER')
  }
  return String(answer)
}

/** Apply the production classifier plus the external-route sentinel to one fixed task. */
function routeLocalTask(task: LeonAcc006LocalTask) {
  return dispatchThroughLeonAcc006Sentinel(chooseAdaptiveModel(leonAcc006RoutingConfig, {
    content: [{ type: 'text', text: task.prompt }],
    hasHistory: task.hasHistory,
    ...task.goalRound === undefined ? {} : { goalRound: task.goalRound },
  }))
}

/** Execute one real model response through the loopback-only Ollama endpoint. */
async function executeLocalTask(endpoint: URL, task: LeonAcc006LocalTask): Promise<TaskEvidence> {
  const decision = routeLocalTask(task)
  expect(decision, task.id).toMatchObject({
    provider: 'ollama',
    model: task.expectedModel,
    tier: task.expectedTier,
  })

  const started = performance.now()
  let content = ''
  let inputTokens = 0
  let outputTokens = 0
  try {
    const response = await fetch(new URL('/api/chat', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: decision.model,
        stream: false,
        think: false,
        keep_alive: '10m',
        format: 'json',
        options: { temperature: 0, seed: 42, num_predict: 64 },
        messages: [
          {
            role: 'system',
            content: 'Responda somente com um objeto JSON no formato {"answer":"valor"}. Não use Markdown nem explique.',
          },
          { role: 'user', content: task.prompt },
        ],
      }),
      signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`)
    const body = await response.json() as OllamaChatResponse
    content = body.message?.content ?? ''
    inputTokens = body.prompt_eval_count ?? 0
    outputTokens = body.eval_count ?? 0
    const normalized = normalizeLeonAcc006Answer(answerFrom(content))
    const passed = task.acceptedAnswers.some(answer => normalizeLeonAcc006Answer(answer) === normalized)
    return {
      id: task.id,
      provider: 'ollama',
      model: decision.model,
      tier: decision.tier,
      passed,
      latencyMs: Math.round(performance.now() - started),
      answerSha256: createHash('sha256').update(normalized).digest('hex'),
      inputTokens,
      outputTokens,
      ...passed ? {} : { errorCode: 'ORACLE_MISMATCH' },
    }
  }
  catch (error: unknown) {
    return {
      id: task.id,
      provider: 'ollama',
      model: decision.model,
      tier: decision.tier,
      passed: false,
      latencyMs: Math.round(performance.now() - started),
      answerSha256: createHash('sha256').update(content).digest('hex'),
      inputTokens,
      outputTokens,
      errorCode: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    }
  }
}

describe('LEON-ACC-006 — contrato de segurança do benchmark Ollama real', () => {
  it('rejeita endpoint externo antes de executar o benchmark', () => {
    expect(loopbackOllamaUrl('http://127.0.0.1:11434').origin).toBe('http://127.0.0.1:11434')
    expect(() => loopbackOllamaUrl('https://api.example.com'))
      .toThrow('LEON-ACC-006_NON_LOOPBACK_ENDPOINT')
    expect(() => loopbackOllamaUrl('http://localhost:11434'))
      .toThrow('LEON-ACC-006_NON_LOOPBACK_ENDPOINT')
    expect(() => loopbackOllamaUrl('http://usuario:segredo@127.0.0.1:11434'))
      .toThrow('LEON-ACC-006_NON_LOOPBACK_ENDPOINT')
  })

  it('valida offline as rotas locais esperadas antes de carregar os modelos', () => {
    expect(leonAcc006LocalTasks).toHaveLength(30)
    for (const task of leonAcc006LocalTasks) {
      const decision = routeLocalTask(task)
      expect(decision, task.id).toMatchObject({
        provider: 'ollama',
        model: task.expectedModel,
        tier: task.expectedTier,
      })
    }
  })
})

realDescribe('LEON-ACC-006 — inferência Ollama real, não conclusão de agente com ferramentas', () => {
  it('executa e valida 30 tarefas locais com evidência sanitizada', async () => {
    expect(leonAcc006LocalTasks).toHaveLength(30)
    const endpoint = loopbackOllamaUrl(process.env.LEON_ACC_006_OLLAMA_URL ?? DEFAULT_OLLAMA_URL)
    const startedAt = new Date().toISOString()
    const evidence: TaskEvidence[] = []
    for (const task of leonAcc006LocalTasks) {
      evidence.push(await executeLocalTask(endpoint, task))
    }
    const completedAt = new Date().toISOString()
    const passed = evidence.filter(item => item.passed).length
    const report = {
      schemaVersion: 1,
      benchmark: 'LEON-ACC-006-local-real-v1',
      interpretation: 'Real loopback Ollama inference and exact task oracles; no Leon agent loop or tool execution.',
      startedAt,
      completedAt,
      endpoint: endpoint.origin,
      totals: {
        tasks: evidence.length,
        passed,
        failed: evidence.length - passed,
        externalDispatches: 0,
        inputTokens: evidence.reduce((sum, item) => sum + item.inputTokens, 0),
        outputTokens: evidence.reduce((sum, item) => sum + item.outputTokens, 0),
      },
      tasks: evidence,
    }
    const reportPath = resolve(
      process.env.LEON_ACC_006_REPORT ?? '.artifacts/leon-acc-006/local-real-latest.json',
    )
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    expect(report.totals.externalDispatches).toBe(0)
    expect(report.totals.tasks).toBe(30)
    expect(report.totals.failed, `relatório: ${reportPath}`).toBe(0)
  }, 20 * 60_000)
})
