/**
 * Small, provider-neutral client for the MiroFish Flask API.
 *
 * The client owns only the HTTP workflow. It does not start Docker, install
 * MiroFish, or persist credentials. The caller supplies the local service URL
 * and an AbortSignal for the whole workflow.
 * @module @deepseek-ai/dsh-experimental-mirofish/client
 */

/** Runtime dependency used at the HTTP boundary and replaced by keyless tests. */
export interface MiroFishHttpRuntime {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

/** Deployment configuration for one MiroFish client. */
export interface MiroFishClientConfig {
  baseUrl: string
  timeoutMs: number
  pollIntervalMs: number
  maxWaitMs: number
  maxSeedChars: number
  maxReportChars: number
}

/** User request sent through the model-facing MiroFish tool. */
export interface MiroFishRunRequest {
  seed: string
  requirement: string
  projectName?: string
  maxRounds?: number
  platform?: 'parallel' | 'twitter' | 'reddit'
  enableTwitter?: boolean
  enableReddit?: boolean
}

/** A durable workflow stage and its last known MiroFish status. */
export interface MiroFishStage {
  name: string
  status: string
  progress?: number
}

/** Canonical result returned after report generation. */
export interface MiroFishRunResult {
  status: 'completed'
  projectId: string
  graphId?: string
  simulationId: string
  reportId: string
  reportMarkdown: string
  reportTruncated: boolean
  stages: MiroFishStage[]
}

interface MiroFishEnvelope {
  success?: boolean
  error?: unknown
  data?: unknown
}

/** Error raised for an HTTP, envelope, timeout, or terminal-task failure. */
export class MiroFishError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message)
    this.name = 'MiroFishError'
  }
}

/**
 * Join a configured base URL and an API path without double slashes.
 * @param baseUrl - MiroFish service root; trailing slashes are trimmed.
 * @param path - API path, which must start with `/`.
 * @returns The absolute request URL.
 */
export function joinMiroFishUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.length === 0) throw new Error('MiroFish baseUrl must be non-empty')
  if (!path.startsWith('/')) throw new Error('MiroFish API path must start with "/"')
  return `${normalized}${path}`
}

/**
 * Read a successful MiroFish response and fail on its `{ success: false }` envelope.
 * @param response - Fetch response from a MiroFish endpoint.
 * @returns The envelope's `data` payload; throws MiroFishError on HTTP errors, invalid JSON, or rejected envelopes.
 */
export async function readMiroFishEnvelope(response: Response): Promise<unknown> {
  const text = await response.text()
  let payload: MiroFishEnvelope
  try {
    payload = text.length === 0 ? {} : JSON.parse(text) as MiroFishEnvelope
  } catch {
    throw new MiroFishError(`MiroFish returned invalid JSON (HTTP ${response.status})`, response.status)
  }
  if (!response.ok) {
    const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
    throw new MiroFishError(`MiroFish request failed: ${detail}`, response.status)
  }
  if (payload.success === false) {
    const detail = typeof payload.error === 'string' ? payload.error : 'unknown MiroFish error'
    throw new MiroFishError(`MiroFish rejected the request: ${detail}`, response.status)
  }
  return payload.data
}

const DEFAULT_RUNTIME: MiroFishHttpRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
}

/**
 * HTTP workflow client for MiroFish's graph, simulation, and report APIs.
 * @param config - bounded service and workflow settings.
 * @param runtime - injectable HTTP runtime for deterministic tests.
 */
export class MiroFishClient {
  constructor(
    private readonly config: MiroFishClientConfig,
    private readonly runtime: MiroFishHttpRuntime = DEFAULT_RUNTIME,
  ) {}

  /**
   * Run ontology generation, graph build, preparation, simulation, and report generation.
   * @param request - Seed text, requirement, and optional simulation parameters.
   * @param signal - Cancellation for the whole multi-stage workflow.
   * @returns The completed run's ids, bounded report Markdown, and per-stage status history.
   */
  async run(request: MiroFishRunRequest, signal: AbortSignal): Promise<MiroFishRunResult> {
    if (request.seed.trim().length === 0) throw new Error('MiroFish seed must be non-empty')
    if (request.requirement.trim().length === 0) throw new Error('MiroFish requirement must be non-empty')
    if (request.seed.length > this.config.maxSeedChars) {
      throw new Error(`MiroFish seed exceeds the ${this.config.maxSeedChars}-character limit`)
    }

    const stages: MiroFishStage[] = []
    const stage = (name: string, status: string, progress?: number): void => {
      const current = stages.find(item => item.name === name)
      const value = { name, status, ...progress === undefined ? {} : { progress } }
      if (current === undefined) stages.push(value)
      else Object.assign(current, value)
    }

    stage('ontology', 'running')
    const ontology = await this.requestForm('/api/graph/ontology/generate', this.createSeedForm(request), signal)
    const ontologyData = asRecord(ontology)
    const projectId = asString(ontologyData.project_id, 'MiroFish ontology response did not include project_id')
    stage('ontology', 'completed', 100)

    stage('graph', 'running')
    const build = await this.requestJson('/api/graph/build', { project_id: projectId }, signal)
    const buildData = asRecord(build)
    const buildTaskId = optionalString(buildData.task_id)
    let graphId = optionalString(buildData.graph_id)
    if (buildTaskId !== undefined) {
      await this.waitForTask('/api/graph/task/', buildTaskId, 'graph', signal, stages)
    }
    if (graphId === undefined) {
      const project = await this.requestJson(`/api/graph/project/${encodeURIComponent(projectId)}`, undefined, signal)
      graphId = optionalString(asRecord(project).graph_id)
    }
    stage('graph', 'completed', 100)

    stage('simulation', 'creating')
    const simulation = await this.requestJson('/api/simulation/create', {
      project_id: projectId,
      ...graphId === undefined ? {} : { graph_id: graphId },
      enable_twitter: request.enableTwitter ?? true,
      enable_reddit: request.enableReddit ?? true,
    }, signal)
    const simulationData = asRecord(simulation)
    const simulationId = asString(simulationData.simulation_id, 'MiroFish response did not include simulation_id')

    stage('preparation', 'running')
    const prepare = await this.requestJson('/api/simulation/prepare', { simulation_id: simulationId }, signal)
    const prepareData = asRecord(prepare)
    const prepareTaskId = optionalString(prepareData.task_id)
    if (prepareTaskId !== undefined) {
      await this.waitForPrepare(prepareTaskId, simulationId, signal, stages)
    } else {
      stage('preparation', normalizeStatus(prepareData.status, 'ready'), 100)
    }
    stage('preparation', 'completed', 100)

    stage('simulation', 'running')
    await this.requestJson('/api/simulation/start', {
      simulation_id: simulationId,
      platform: request.platform ?? 'parallel',
      ...request.maxRounds === undefined ? {} : { max_rounds: request.maxRounds },
      enable_graph_memory_update: false,
    }, signal)
    await this.waitForRun(simulationId, signal, stages)
    stage('simulation', 'completed', 100)

    stage('report', 'generating')
    const reportStart = await this.requestJson('/api/report/generate', { simulation_id: simulationId }, signal)
    const reportStartData = asRecord(reportStart)
    let reportId = optionalString(reportStartData.report_id)
    const reportTaskId = optionalString(reportStartData.task_id)
    if (reportTaskId !== undefined) {
      const reportStatus = await this.waitForReport(reportTaskId, simulationId, signal, stages)
      reportId = reportId ?? optionalString(asRecord(reportStatus).report_id)
    }
    if (reportId === undefined) {
      const existing = await this.requestJson(`/api/report/by-simulation/${encodeURIComponent(simulationId)}`, undefined, signal)
      reportId = asString(asRecord(existing).report_id, 'MiroFish report response did not include report_id')
    }
    const report = asRecord(await this.requestJson(`/api/report/${encodeURIComponent(reportId)}`, undefined, signal))
    const markdown = asString(report.markdown_content, 'MiroFish report did not include markdown_content')
    const reportTruncated = markdown.length > this.config.maxReportChars
    stage('report', 'completed', 100)

    return {
      status: 'completed',
      projectId,
      ...graphId === undefined ? {} : { graphId },
      simulationId,
      reportId,
      reportMarkdown: reportTruncated ? markdown.slice(0, this.config.maxReportChars) : markdown,
      reportTruncated,
      stages,
    }
  }

  private createSeedForm(request: MiroFishRunRequest): FormData {
    const form = new FormData()
    form.append('simulation_requirement', request.requirement)
    form.append('project_name', request.projectName?.trim() || 'Leon MiroFish simulation')
    form.append('files', new Blob([request.seed], { type: 'text/markdown' }), 'leon-seed.md')
    return form
  }

  private async requestJson(path: string, body: Record<string, unknown> | undefined, signal: AbortSignal): Promise<unknown> {
    const response = await this.withTimeout(signal, controller => this.runtime.fetch(joinMiroFishUrl(this.config.baseUrl, path), {
      method: body === undefined ? 'GET' : 'POST',
      ...body === undefined ? {} : {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      signal: controller.signal,
    }))
    return readMiroFishEnvelope(response)
  }

  private async requestForm(path: string, body: FormData, signal: AbortSignal): Promise<unknown> {
    const response = await this.withTimeout(signal, controller => this.runtime.fetch(joinMiroFishUrl(this.config.baseUrl, path), {
      method: 'POST',
      body,
      signal: controller.signal,
    }))
    return readMiroFishEnvelope(response)
  }

  private async withTimeout<T>(signal: AbortSignal, operation: (controller: AbortController) => Promise<T>): Promise<T> {
    if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const controller = new AbortController()
    const relay = (): void => { controller.abort(signal.reason) }
    signal.addEventListener('abort', relay, { once: true })
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('MiroFish request timed out', 'TimeoutError'))
    }, this.config.timeoutMs)
    try {
      return await operation(controller)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', relay)
    }
  }

  private async waitForTask(
    prefix: string, taskId: string, stageName: string, signal: AbortSignal, stages: MiroFishStage[],
  ): Promise<void> {
    await this.poll(async () => await this.requestJson(
      `${prefix}${encodeURIComponent(taskId)}`, undefined, signal,
    ), stageName, signal, stages)
  }

  private async waitForPrepare(taskId: string, simulationId: string, signal: AbortSignal, stages: MiroFishStage[]): Promise<void> {
    await this.poll(async () => await this.requestJson('/api/simulation/prepare/status', { task_id: taskId, simulation_id: simulationId }, signal), 'preparation', signal, stages)
  }

  private async waitForRun(simulationId: string, signal: AbortSignal, stages: MiroFishStage[]): Promise<void> {
    await this.poll(async () => await this.requestJson(`/api/simulation/${encodeURIComponent(simulationId)}/run-status`, undefined, signal), 'simulation', signal, stages, true)
  }

  private async waitForReport(taskId: string, simulationId: string, signal: AbortSignal, stages: MiroFishStage[]): Promise<unknown> {
    return this.poll(async () => await this.requestJson('/api/report/generate/status', { task_id: taskId, simulation_id: simulationId }, signal), 'report', signal, stages)
  }

  private async poll(
    read: () => Promise<unknown>,
    stageName: string,
    signal: AbortSignal,
    stages: MiroFishStage[],
    runStatus = false,
  ): Promise<unknown> {
    const deadline = Date.now() + this.config.maxWaitMs
    for (;;) {
      const data = asRecord(await read())
      const status = normalizeStatus(runStatus ? data.runner_status : data.status, 'processing')
      const progress = optionalNumber(data.progress_percent) ?? optionalNumber(data.progress)
      const stage = stages.find(item => item.name === stageName)
      if (stage === undefined) stages.push({ name: stageName, status, ...progress === undefined ? {} : { progress } })
      else Object.assign(stage, { status, ...progress === undefined ? {} : { progress } })
      if (isSuccessStatus(status, runStatus)) return data
      if (isFailureStatus(status)) throw new MiroFishError(`MiroFish ${stageName} failed with status ${status}`)
      if (Date.now() >= deadline) throw new MiroFishError(`MiroFish ${stageName} exceeded the ${this.config.maxWaitMs} ms wait limit`)
      await delay(this.config.pollIntervalMs, signal)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MiroFishError('MiroFish returned an unexpected data object')
  return value as Record<string, unknown>
}

function asString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new MiroFishError(message)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeStatus(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : fallback
}

function isSuccessStatus(status: string, runStatus: boolean): boolean {
  return runStatus ? ['completed', 'stopped'].includes(status) : ['completed', 'succeeded', 'success', 'ready'].includes(status)
}

function isFailureStatus(status: string): boolean {
  return ['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
