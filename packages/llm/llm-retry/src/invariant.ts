/** Package-owned durable retry-event invariants. @module @deepseek-ai/dsh-llm-retry/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { providerForOpenStep } from './history.ts'
import type {} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-retry'

/** Cordis companion plugin name. */
export const name = 'llm-retry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the complete provider-neutral failure payload at the durable boundary. */
function validateFailure(value: unknown, fail: InvariantFailure, eventType = 'llm/retry'): asserts value is LlmFailure {
  if (typeof value !== 'object' || value === null) {
    fail(`${eventType} failure must be an object`)
  }
  const failure = value as Partial<LlmFailure>
  if (typeof failure.message !== 'string' || failure.message.length === 0) {
    fail(`${eventType} failure.message must be a non-empty string`)
  }
  if (typeof failure.code !== 'string' || failure.code.length === 0) {
    fail(`${eventType} failure.code must be a non-empty string`)
  }
  if (failure.status !== undefined
    && (!Number.isInteger(failure.status) || failure.status < 100 || failure.status > 599)) {
    fail(`${eventType} failure.status must be an integer from 100 through 599 when present`)
  }
  if (failure.providerRetryAfterMs !== undefined
    && (!Number.isFinite(failure.providerRetryAfterMs) || failure.providerRetryAfterMs <= 0)) {
    fail(`${eventType} failure.providerRetryAfterMs must be a positive finite number when present`)
  }
  if (failure.requestId !== undefined
    && (typeof failure.requestId !== 'string' || failure.requestId.length === 0)) {
    fail(`${eventType} failure.requestId must be a non-empty string when present`)
  }
}

/** Validate that an event identifies the currently open request step. */
function validateOpenStep(
  history: readonly SessionEvent[],
  turn: number,
  step: number,
  eventType: string,
  fail: InvariantFailure,
): void {
  const turnBoundary = history.findLast(prior =>
    prior.type === 'turn/start' || prior.type === 'turn/end')
  if (turnBoundary?.type !== 'turn/start') {
    fail(`${eventType} must be appended inside an open turn`)
  }
  if (turn !== turnBoundary.data.turn) {
    fail(`${eventType} names turn ${turn}, but the open turn is ${turnBoundary.data.turn}`)
  }
  const stepBoundary = history.findLast(prior =>
    prior.type === 'step/start' || prior.type === 'step/end')
  if (stepBoundary?.type !== 'step/start') {
    fail(`${eventType} must be appended inside an open step`)
  }
  if (step !== stepBoundary.data.step || turn !== stepBoundary.data.turn) {
    fail(`${eventType} names turn ${turn}/step ${step}, but the open step is ${stepBoundary.data.turn}/${stepBoundary.data.step}`)
  }
}

/** Validate one retry record against the currently open request step. */
function validateRetry(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/retry'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, provider, mode, policyKey, retry, delayMs } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/retry retryId must be a non-empty string')
  }
  const failure: unknown = event.data.failure
  validateFailure(failure, fail)
  if (!Number.isSafeInteger(retry) || retry < 1) {
    fail('llm/retry retry must be a positive safe integer')
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    fail('llm/retry provider must be a non-empty string')
  }
  if (typeof policyKey !== 'string' || policyKey.length === 0) {
    fail('llm/retry policyKey must be a non-empty string')
  }
  switch (mode) {
    case 'normal': {
      const { maxRetries } = event.data
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 1 || retry > maxRetries) {
        fail(`llm/retry retry ${retry} must not exceed a positive safe maxRetries ${maxRetries}`)
      }
      break
    }
    case 'always':
      if ('maxRetries' in event.data) fail('llm/retry always mode must omit maxRetries')
      break
    default:
      fail(`llm/retry mode must be normal or always, got ${String(mode)}`)
  }
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)
    || delayMs < 0 || delayMs > MAX_TIMER_DELAY_MS) {
    fail(`llm/retry delayMs must be a finite number within 0..${MAX_TIMER_DELAY_MS}`)
  }

  validateOpenStep(history, turn, step, 'llm/retry', fail)
  const routedProvider = providerForOpenStep(history, turn, step)
  if (routedProvider !== provider) {
    fail(`llm/retry provider ${provider} does not match the failed request provider ${String(routedProvider)}`)
  }

  const priorPolicyRetry = history.findLast((prior): prior is SessionEvent<'llm/retry'> =>
    prior.type === 'llm/retry'
    && prior.data.turn === turn
    && prior.data.step === step
    && prior.data.provider === provider
    && prior.data.policyKey === policyKey)
  const expectedRetry = (priorPolicyRetry?.data.retry ?? 0) + 1
  if (retry !== expectedRetry) {
    fail(`llm/retry retry ${retry} must equal provider policy retry ${expectedRetry}`)
  }
  if (priorPolicyRetry !== undefined && priorPolicyRetry.data.retryId !== retryId) {
    fail('llm/retry must preserve retryId across one provider-policy chain')
  }
  if (priorPolicyRetry === undefined && history.some(prior =>
    (prior.type === 'llm/retry' || prior.type === 'llm/retry-started')
    && prior.data.retryId === retryId)) {
    fail(`llm/retry retryId ${JSON.stringify(retryId)} is already owned by another chain`)
  }
}

/** Validate one provider replacement against the currently routed request. */
function validateFailover(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/failover'>,
  fail: InvariantFailure,
): void {
  const { turn, step, from, to, reason } = event.data
  validateOpenStep(history, turn, step, 'llm/failover', fail)
  validateFailure(event.data.failure, fail, 'llm/failover')
  for (const [label, candidate] of [['from', from], ['to', to]] as readonly [string, unknown][]) {
    if (typeof candidate !== 'object' || candidate === null) {
      fail(`llm/failover ${label} must be an object`)
    }
    const route = candidate as Record<string, unknown>
    if (typeof route.provider !== 'string' || route.provider.length === 0) {
      fail(`llm/failover ${label}.provider must be a non-empty string`)
    }
    if (typeof route.model !== 'string' || route.model.length === 0) {
      fail(`llm/failover ${label}.model must be a non-empty string`)
    }
  }
  const observedReason: unknown = reason
  if (observedReason !== 'provider-unavailable') {
    fail(`llm/failover reason must be provider-unavailable, got ${reason}`)
  }
  if (from.provider === to.provider) {
    fail('llm/failover replacement provider must differ from the failed provider')
  }
  const routed = history.findLast(prior => prior.type === 'request/header')?.data.header.config
  if (routed?.provider !== from.provider || routed.model !== from.model) {
    fail(`llm/failover failed route ${from.provider}/${from.model} does not match the active request route ${String(routed?.provider)}/${String(routed?.model)}`)
  }
}

/** Validate one wait-complete transition against its scheduled attempt. */
function validateStarted(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/retry-started'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, retry } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/retry-started retryId must be a non-empty string')
  }
  const scheduled = history.findLast((prior): prior is SessionEvent<'llm/retry'> =>
    prior.type === 'llm/retry' && prior.data.retryId === retryId && prior.data.retry === retry)
  if (scheduled === undefined) fail('llm/retry-started pairs no prior scheduled attempt')
  if (scheduled.data.turn !== turn || scheduled.data.step !== step) {
    fail('llm/retry-started turn/step must match its scheduled attempt')
  }
  if (history.some(prior => prior.type === 'llm/retry-started'
    && prior.data.retryId === retryId && prior.data.retry === retry)) {
    fail('llm/retry-started repeats one scheduled attempt')
  }
}

/** Validate every retry record already present in one loaded session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    if (event.type === 'llm/retry') validateRetry(session.events.slice(0, index), event, fail)
    else if (event.type === 'llm/retry-started') validateStarted(session.events.slice(0, index), event, fail)
    else if (event.type === 'llm/failover') validateFailover(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended retry records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type === 'llm/retry') validateRetry(session.events, event, fail)
    else if (event.type === 'llm/retry-started') validateStarted(session.events, event, fail)
    else if (event.type === 'llm/failover') validateFailover(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the LLM retry invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
