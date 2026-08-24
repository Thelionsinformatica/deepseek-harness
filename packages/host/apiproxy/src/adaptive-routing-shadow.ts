/**
 * Provider-neutral shadow preflight for Leon Automatic.
 *
 * The observer reads an already assembled, frozen request before the adapter
 * consumes it. It records only structural metadata and a recommendation: the
 * selected provider/model and the request itself are never rewritten.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  contentHasImage,
  isAgentLoopRequest,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type ModelModality,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type TokenMeter from '@deepseek-ai/dsh-token-meter'

/** Stable reasons explaining why a shadow candidate was not selected. */
export type AdaptiveShadowRejectionReason =
  | 'route-unavailable'
  | 'modality-unsupported'
  | 'context-capacity'
  | 'output-capacity'
  | 'quality-below-required'
  | 'external-denied'
  | 'local-capable'
  | 'circuit-open'
  | 'recent-capacity-failure'

/** One route the deployment authorizes the shadow policy to consider. */
export interface AdaptiveShadowRouteConfig {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Local execution or a route that may transmit request content externally. */
  residency: 'local' | 'external'
  /** Relative task-quality tier; higher values represent stronger routes. */
  quality: number
  /** Deployment preference after hard capability filters; lower values win. */
  priority: number
  /** Cold-start TTFT baseline used until this deployment has measured the route. */
  coldStartTtftMs?: number
  /** Optional input price used only for a projected, non-billing estimate. */
  inputUsdPerMillion?: number
  /** Optional output price used only for a projected, non-billing estimate. */
  outputUsdPerMillion?: number
}

/** Shadow-only policy. It never grants authority to replace a model route. */
export interface AdaptiveRoutingShadowConfig {
  /** Human-readable policy revision persisted with every decision. */
  policyVersion: string
  /** Explicit candidate catalog in deployment preference order. */
  routes: AdaptiveShadowRouteConfig[]
  /** Whether an external candidate may be recommended. */
  externalPolicy?: 'deny' | 'fallback-only' | 'allow'
  /** Output allowance added to current input pressure. */
  outputReserveTokens?: number
  /** Additional allowance for tool-result growth within an autonomous loop. */
  toolLoopReserveTokens?: number
  /** Structural threshold that raises the minimum route quality to two. */
  mediumInputTokens?: number
  /** Structural threshold that raises the minimum route quality to three. */
  expertInputTokens?: number
  /** Message-count threshold that raises the minimum route quality to three. */
  expertMessageCount?: number
  /** Tool-count threshold that raises the minimum route quality to three. */
  expertToolCount?: number
  /** Consecutive provider failures required before the shadow circuit opens. */
  circuitBreakerFailures?: number
  /** Samples required before measured latency can mark a route degraded. */
  latencyMinSamples?: number
  /** Route-relative TTFT multiple that marks a measured route degraded. */
  latencyDegradedMultiplier?: number
  /** How long a same-session capacity failure remains relevant to routing. */
  capacityFailureCooldownMs?: number
}

/** Structural request facts retained in the durable decision. No content is included. */
export interface AdaptiveShadowRequestFacts {
  estimatedInputTokens: number
  reservedOutputTokens: number
  toolLoopReserveTokens: number
  projectedTokens: number
  messageCount: number
  toolCount: number
  imageCount: number
  minimumQuality: number
}

/** Route health facts measured without interpreting request content. */
export interface AdaptiveShadowHealth {
  status: 'cold' | 'healthy' | 'degraded' | 'open'
  samples: number
  consecutiveProviderFailures: number
  baselineTtftMs?: number
}

/** Runtime capability and health facts for one configured route. */
export interface AdaptiveShadowCandidateFacts extends AdaptiveShadowRouteConfig {
  available: boolean
  contextWindow?: number
  maxOutputTokens?: number
  inputModalities?: readonly ModelModality[]
  health: AdaptiveShadowHealth
  recentCapacityFailure?: string
}

/** Auditable assessment of one candidate; ordered reasons explain rejection. */
export interface AdaptiveShadowCandidateDecision {
  provider: string
  model: string
  residency: 'local' | 'external'
  quality: number
  priority: number
  eligible: boolean
  reasons: AdaptiveShadowRejectionReason[]
  health: AdaptiveShadowHealth
  contextWindow?: number
  maxOutputTokens?: number
  projectedCostUsd?: number
}

/** Pure shadow decision before it is correlated to a session step. */
export interface AdaptiveShadowDecision {
  recommendation:
    | { kind: 'route'; provider: string; model: string; projectedCostUsd?: number }
    | { kind: 'blocked'; reason: 'no-capable-route' }
  candidates: AdaptiveShadowCandidateDecision[]
}

/** Durable, content-free record of one shadow preflight. */
export interface AdaptiveRoutingShadowEventData {
  schemaVersion: 1
  policyVersion: string
  mode: 'shadow'
  requestId: string
  turn: number
  step: number
  observed: {
    provider: string
    model: string
    reasoningEffort?: string
  }
  request: AdaptiveShadowRequestFacts
  recommendation: AdaptiveShadowDecision['recommendation']
  wouldChange: boolean
  candidates: AdaptiveShadowCandidateDecision[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface recommendation from a router that has no authority to change the active model. */
    'llm/routing-shadow': AdaptiveRoutingShadowEventData
  }
}

interface RouteTelemetry {
  samples: number
  consecutiveProviderFailures: number
  ewmaTtftMs?: number
  lastTtftMs?: number
}

interface CapacityFailure {
  code: string
  at: number
}

const CAPACITY_FAILURE_CODES = new Set([
  'CONTEXT_WINDOW_EXCEEDED',
  'CONTEXT_LENGTH_EXCEEDED',
  'MAX_TOKENS',
])

const DEFAULT_OUTPUT_RESERVE = 8192
const DEFAULT_TOOL_LOOP_RESERVE = 4096
const DEFAULT_MEDIUM_INPUT = 12000
const DEFAULT_EXPERT_INPUT = 24000
const DEFAULT_EXPERT_MESSAGES = 20
const DEFAULT_EXPERT_TOOLS = 8
const DEFAULT_CIRCUIT_FAILURES = 3
const DEFAULT_LATENCY_MIN_SAMPLES = 3
const DEFAULT_LATENCY_MULTIPLIER = 2.5
const DEFAULT_CAPACITY_COOLDOWN_MS = 10 * 60 * 1000

function routeKey(provider: string, model: string): string {
  return `${provider}\0${model}`
}

function finiteNonNegative(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0)
}

/**
 * Refuse ambiguous or unsafe deployment policy before observation begins.
 * @param config - Explicit candidate catalog and shadow-only policy controls.
 */
export function validateAdaptiveRoutingShadowConfig(config: AdaptiveRoutingShadowConfig): void {
  if (config.policyVersion.trim().length === 0) {
    throw new Error('adaptive routing shadow policyVersion must be non-empty')
  }
  if (config.routes.length === 0) throw new Error('adaptive routing shadow needs at least one route')
  const seen = new Set<string>()
  for (const route of config.routes) {
    if (route.provider.trim().length === 0 || route.model.trim().length === 0) {
      throw new Error('adaptive routing shadow routes need non-empty provider and model ids')
    }
    if (!Number.isSafeInteger(route.quality) || route.quality < 1) {
      throw new Error(`adaptive routing shadow route ${route.provider}/${route.model} quality must be a positive integer`)
    }
    if (!Number.isSafeInteger(route.priority) || route.priority < 0) {
      throw new Error(`adaptive routing shadow route ${route.provider}/${route.model} priority must be a non-negative integer`)
    }
    if (!finiteNonNegative(route.inputUsdPerMillion) || !finiteNonNegative(route.outputUsdPerMillion)) {
      throw new Error(`adaptive routing shadow route ${route.provider}/${route.model} prices must be non-negative`)
    }
    const key = routeKey(route.provider, route.model)
    if (seen.has(key)) throw new Error(`adaptive routing shadow repeats route ${route.provider}/${route.model}`)
    seen.add(key)
  }
}

function projectedCost(
  route: AdaptiveShadowRouteConfig,
  request: AdaptiveShadowRequestFacts,
): number | undefined {
  if (route.inputUsdPerMillion === undefined || route.outputUsdPerMillion === undefined) return undefined
  return (request.estimatedInputTokens * route.inputUsdPerMillion
    + request.reservedOutputTokens * route.outputUsdPerMillion) / 1_000_000
}

function modalityReasons(
  route: AdaptiveShadowCandidateFacts,
  request: AdaptiveShadowRequestFacts,
): AdaptiveShadowRejectionReason[] {
  const reasons: AdaptiveShadowRejectionReason[] = []
  if (!route.available) reasons.push('route-unavailable')
  if (request.imageCount > 0
    && route.inputModalities !== undefined
    && !route.inputModalities.includes('image')) reasons.push('modality-unsupported')
  if (route.contextWindow !== undefined && request.projectedTokens > route.contextWindow) {
    reasons.push('context-capacity')
  }
  if (route.maxOutputTokens !== undefined && request.reservedOutputTokens > route.maxOutputTokens) {
    reasons.push('output-capacity')
  }
  if (route.quality < request.minimumQuality) reasons.push('quality-below-required')
  if (route.health.status === 'open') reasons.push('circuit-open')
  if (route.recentCapacityFailure !== undefined) reasons.push('recent-capacity-failure')
  return reasons
}

/**
 * Select the deployment-preferred capable route without mutating live state.
 * Candidate ordering is deterministic and every exclusion remains inspectable.
 * @param config - Shadow policy controlling privacy and deployment preference.
 * @param request - Content-free structural facts for the assembled request.
 * @param routes - Resolved capabilities and process-local health for each candidate.
 * @returns the recommendation and complete ordered candidate assessments.
 */
export function evaluateAdaptiveRoutingShadow(
  config: AdaptiveRoutingShadowConfig,
  request: AdaptiveShadowRequestFacts,
  routes: readonly AdaptiveShadowCandidateFacts[],
): AdaptiveShadowDecision {
  const initial = routes.map((route) => {
    const reasons = modalityReasons(route, request)
    return {
      route,
      reasons,
      cost: projectedCost(route, request),
    }
  })
  const localCapable = initial.some(candidate =>
    candidate.route.residency === 'local' && candidate.reasons.length === 0)
  const externalPolicy = config.externalPolicy ?? 'fallback-only'
  const assessed = initial.map(({ route, reasons, cost }): AdaptiveShadowCandidateDecision => {
    const finalReasons = [...reasons]
    if (route.residency === 'external') {
      if (externalPolicy === 'deny') finalReasons.push('external-denied')
      else if (externalPolicy === 'fallback-only' && localCapable) finalReasons.push('local-capable')
    }
    return {
      provider: route.provider,
      model: route.model,
      residency: route.residency,
      quality: route.quality,
      priority: route.priority,
      eligible: finalReasons.length === 0,
      reasons: finalReasons,
      health: route.health,
      ...route.contextWindow === undefined ? {} : { contextWindow: route.contextWindow },
      ...route.maxOutputTokens === undefined ? {} : { maxOutputTokens: route.maxOutputTokens },
      ...cost === undefined ? {} : { projectedCostUsd: cost },
    }
  })
  const selected = assessed
    .filter(candidate => candidate.eligible)
    .toSorted((left, right) => {
      const health = (left.health.status === 'degraded' ? 1 : 0) - (right.health.status === 'degraded' ? 1 : 0)
      if (health !== 0) return health
      if (left.priority !== right.priority) return left.priority - right.priority
      if (left.quality !== right.quality) return left.quality - right.quality
      return `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`)
    })[0]
  return {
    recommendation: selected === undefined
      ? { kind: 'blocked', reason: 'no-capable-route' }
      : {
        kind: 'route',
        provider: selected.provider,
        model: selected.model,
        ...selected.projectedCostUsd === undefined ? {} : { projectedCostUsd: selected.projectedCostUsd },
      },
    candidates: assessed,
  }
}

function imageCount(options: GenerateOptions): number {
  let count = 0
  for (const message of options.messages) {
    if (contentHasImage(message.content)) count += 1
  }
  return count
}

/** Conservative fallback used only when the deployment omits the token-meter service. */
function fallbackInputEstimate(options: GenerateOptions): number {
  const text = (options.system?.length ?? 0)
    + JSON.stringify(options.tools ?? []).length
    + JSON.stringify(options.messages).length
  return Math.max(1, Math.ceil(text / 4))
}

function requestFacts(
  config: AdaptiveRoutingShadowConfig,
  options: GenerateOptions,
  session: Session,
  meter: TokenMeter | undefined,
  observedQuality: number,
): AdaptiveShadowRequestFacts {
  const estimatedInputTokens = meter?.measure(session).totalTokens ?? fallbackInputEstimate(options)
  const reservedOutputTokens = options.maxTokens ?? config.outputReserveTokens ?? DEFAULT_OUTPUT_RESERVE
  const toolCount = options.tools?.length ?? 0
  const images = imageCount(options)
  const messageCount = options.messages.length
  let structuralQuality = 1
  if (estimatedInputTokens >= (config.mediumInputTokens ?? DEFAULT_MEDIUM_INPUT) || toolCount > 0) {
    structuralQuality = 2
  }
  if (estimatedInputTokens >= (config.expertInputTokens ?? DEFAULT_EXPERT_INPUT)
    || messageCount >= (config.expertMessageCount ?? DEFAULT_EXPERT_MESSAGES)
    || toolCount >= (config.expertToolCount ?? DEFAULT_EXPERT_TOOLS)
    || (images > 0 && toolCount > 0)) structuralQuality = 3
  const toolLoopReserveTokens = toolCount === 0
    ? 0
    : config.toolLoopReserveTokens ?? DEFAULT_TOOL_LOOP_RESERVE
  return {
    estimatedInputTokens,
    reservedOutputTokens,
    toolLoopReserveTokens,
    projectedTokens: estimatedInputTokens + reservedOutputTokens + toolLoopReserveTokens,
    messageCount,
    toolCount,
    imageCount: images,
    minimumQuality: Math.max(structuralQuality, observedQuality),
  }
}

function openStep(session: Session): { turn: number; step: number } | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'step/start')
  if (event?.type !== 'step/start') return undefined
  const ended = session.events.some(candidate => candidate.type === 'step/end'
    && candidate.data.turn === event.data.turn
    && candidate.data.step === event.data.step
    && candidate.seq > event.seq)
  return ended ? undefined : event.data
}

/** Runtime observer state is process-local; only decisions become durable. */
class AdaptiveShadowRuntime {
  private readonly routeTelemetry = new Map<string, RouteTelemetry>()
  private readonly capacityFailures = new WeakMap<Session, Map<string, CapacityFailure>>()

  constructor(
    private readonly ctx: Context,
    private readonly config: AdaptiveRoutingShadowConfig,
  ) {}

  private telemetry(route: AdaptiveShadowRouteConfig): AdaptiveShadowHealth {
    const stats = this.routeTelemetry.get(routeKey(route.provider, route.model))
    const samples = stats?.samples ?? 0
    const failures = stats?.consecutiveProviderFailures ?? 0
    const baselineTtftMs = stats?.ewmaTtftMs ?? route.coldStartTtftMs
    let status: AdaptiveShadowHealth['status'] = samples < (this.config.latencyMinSamples ?? DEFAULT_LATENCY_MIN_SAMPLES)
      ? 'cold'
      : 'healthy'
    if (failures >= (this.config.circuitBreakerFailures ?? DEFAULT_CIRCUIT_FAILURES)) status = 'open'
    else if (samples >= (this.config.latencyMinSamples ?? DEFAULT_LATENCY_MIN_SAMPLES)
      && stats?.lastTtftMs !== undefined
      && baselineTtftMs !== undefined
      && stats.lastTtftMs > baselineTtftMs * (this.config.latencyDegradedMultiplier ?? DEFAULT_LATENCY_MULTIPLIER)) {
      status = 'degraded'
    }
    return {
      status,
      samples,
      consecutiveProviderFailures: failures,
      ...baselineTtftMs === undefined ? {} : { baselineTtftMs },
    }
  }

  private recentCapacityFailure(session: Session, route: AdaptiveShadowRouteConfig): string | undefined {
    const failure = this.capacityFailures.get(session)?.get(routeKey(route.provider, route.model))
    if (failure === undefined) return undefined
    if (Date.now() - failure.at > (this.config.capacityFailureCooldownMs ?? DEFAULT_CAPACITY_COOLDOWN_MS)) {
      return undefined
    }
    return failure.code
  }

  private async resolveRoute(
    session: Session,
    route: AdaptiveShadowRouteConfig,
  ): Promise<AdaptiveShadowCandidateFacts> {
    let info: LlmResolvedModelInfo | undefined
    try {
      info = await this.ctx.llm.resolveModelInfo(route.provider, route.model)
    } catch {
      // Availability is recorded as one reason; provider errors and credentials
      // are neither copied to the session log nor mistaken for request content.
    }
    const recentCapacityFailure = this.recentCapacityFailure(session, route)
    return {
      ...route,
      available: info !== undefined,
      ...info?.context?.contextWindow === undefined ? {} : { contextWindow: info.context.contextWindow },
      ...info?.defaultMaxTokens === undefined ? {} : { maxOutputTokens: info.defaultMaxTokens },
      ...info?.inputModalities === undefined ? {} : { inputModalities: info.inputModalities },
      health: this.telemetry(route),
      ...recentCapacityFailure === undefined ? {} : { recentCapacityFailure },
    }
  }

  async observe(options: GenerateOptions, session: Session, step: { turn: number; step: number }): Promise<void> {
    const observedRoute = this.config.routes.find(route =>
      route.provider === options.provider && route.model === options.model)
    const facts = requestFacts(
      this.config,
      options,
      session,
      this.ctx.get('tokenMeter'),
      observedRoute?.quality ?? 1,
    )
    const routes = await Promise.all(this.config.routes.map(route => this.resolveRoute(session, route)))
    const decision = evaluateAdaptiveRoutingShadow(this.config, facts, routes)
    if (this.ctx.agents.get(session.id)?.session !== session) return
    const recommendation = decision.recommendation
    const wouldChange = recommendation.kind === 'route'
      && (recommendation.provider !== options.provider || recommendation.model !== options.model)
    session.append('llm/routing-shadow', {
      schemaVersion: 1,
      policyVersion: this.config.policyVersion,
      mode: 'shadow',
      requestId: randomUUID(),
      turn: step.turn,
      step: step.step,
      observed: {
        provider: options.provider,
        model: options.model,
        ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
      },
      request: facts,
      recommendation,
      wouldChange,
      candidates: decision.candidates,
    })
    const recommended = recommendation.kind === 'route'
      ? `${recommendation.provider}/${recommendation.model}`
      : recommendation.reason
    this.ctx.logger.info(
      `leon routing shadow: session=${session.id} turn=${step.turn} step=${step.step} `
      + `observed=${options.provider}/${options.model} recommended=${recommended} wouldChange=${String(wouldChange)}`,
    )
  }

  private recordFinish(session: Session, options: GenerateOptions, finish: Extract<StreamChunk, { type: 'finish' }>, ttftMs: number): void {
    const key = routeKey(options.provider, options.model)
    const previous = this.routeTelemetry.get(key)
    const stats: RouteTelemetry = {
      samples: (previous?.samples ?? 0) + 1,
      consecutiveProviderFailures: previous?.consecutiveProviderFailures ?? 0,
      lastTtftMs: ttftMs,
      ewmaTtftMs: previous?.ewmaTtftMs === undefined
        ? ttftMs
        : previous.ewmaTtftMs * 0.8 + ttftMs * 0.2,
    }
    if (finish.reason.kind === 'max-tokens') {
      let failures = this.capacityFailures.get(session)
      if (failures === undefined) {
        failures = new Map()
        this.capacityFailures.set(session, failures)
      }
      failures.set(key, { code: 'MAX_TOKENS', at: Date.now() })
      stats.consecutiveProviderFailures = 0
    } else if (finish.reason.kind === 'error') {
      if (CAPACITY_FAILURE_CODES.has(finish.reason.failure.code)) {
        let failures = this.capacityFailures.get(session)
        if (failures === undefined) {
          failures = new Map()
          this.capacityFailures.set(session, failures)
        }
        failures.set(key, { code: finish.reason.failure.code, at: Date.now() })
        stats.consecutiveProviderFailures = 0
      } else {
        stats.consecutiveProviderFailures += 1
      }
    } else if (finish.reason.kind !== 'aborted') {
      stats.consecutiveProviderFailures = 0
    }
    this.routeTelemetry.set(key, stats)
  }

  monitor(options: GenerateOptions, session: Session, stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const startedAt = Date.now()
    const record = this.recordFinish.bind(this)
    return (async function* (): AsyncGenerator<StreamChunk> {
      let firstAt: number | undefined
      for await (const chunk of stream) {
        firstAt ??= Date.now()
        if (chunk.type === 'finish') record(session, options, chunk, firstAt - startedAt)
        yield chunk
      }
    })()
  }
}

/**
 * Install the passive preflight around the final LLM stream boundary.
 * Calling `next()` happens before observation starts, and the returned stream
 * is never replaced; metadata resolution and durable logging run out of band.
 * @param ctx - Host context carrying Agents, LLM runtime, Sessions, and optional token meter.
 * @param config - Candidate catalog and shadow-only decision policy.
 * @param enabledFor - Session-mode guard; manual model selections return false.
 * @returns a disposer for the global stream observer.
 */
export function installAdaptiveRoutingShadow(
  ctx: Context,
  config: AdaptiveRoutingShadowConfig,
  enabledFor: (agent: Agent) => boolean,
): () => void {
  validateAdaptiveRoutingShadowConfig(config)
  const runtime = new AdaptiveShadowRuntime(ctx, config)
  return ctx.on('llm/stream', (options, next) => {
    const stream = next()
    if (!isAgentLoopRequest(options) || options.sessionId === undefined || options.purpose !== undefined) return stream
    const agent = ctx.agents.get(options.sessionId)
    if (agent === undefined || !enabledFor(agent)) return stream
    const step = openStep(agent.session)
    if (step === undefined) return stream
    void runtime.observe(options, agent.session, step).catch((error: unknown) => {
      ctx.logger.warn(`leon routing shadow observation failed without changing the active route: ${String(error)}`)
    })
    return runtime.monitor(options, agent.session, stream)
  }, { global: true })
}
