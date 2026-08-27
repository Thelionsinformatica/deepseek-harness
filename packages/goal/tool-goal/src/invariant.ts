/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-goal`.
 * @module @deepseek-ai/dsh-tool-goal/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { completionEvidenceDigest } from './completion-evidence.ts'
import type {} from './completion-evidence.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-goal'

/** Cordis companion plugin name. */
export const name = 'tool-goal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether a JSON value is an ordinary record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require an exact field set so future writers cannot smuggle unreviewed content into the receipt. */
function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string, fail: InvariantFailure): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    fail(`${field} has an invalid field set`)
  }
}

/** Locate the currently open turn in one committed prefix. */
function openTurn(events: readonly SessionEvent[]): number | undefined {
  let current: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') current = event.data.turn
    else if (event.type === 'turn/end') current = undefined
  }
  return current
}

/** Validate one PASS receipt against the immutable committed prefix it claims to cover. */
function validateAuditEvent(
  prefix: readonly SessionEvent[],
  event: SessionEvent<'goal/completion-audit'>,
  fail: InvariantFailure,
): void {
  if (openTurn(prefix) === undefined) fail('goal/completion-audit appended outside any open turn')
  const data = event.data as unknown
  if (!isRecord(data)) fail('goal/completion-audit data must be a record')
  exactKeys(data, ['auditedAt', 'auditor', 'completedTodoCount', 'evidence', 'goal', 'version'], 'goal/completion-audit', fail)
  if (data['version'] !== 1) fail('goal/completion-audit version must be 1')

  const goal = data['goal']
  if (!isRecord(goal)) fail('goal/completion-audit goal must be a record')
  exactKeys(goal, ['id', 'revision'], 'goal/completion-audit goal', fail)
  if (typeof goal['id'] !== 'string' || goal['id'].length === 0
    || !Number.isSafeInteger(goal['revision']) || (goal['revision'] as number) < 1) {
    fail('goal/completion-audit goal identity is invalid')
  }
  const current = foldGoal(prefix).goal
  if (current === undefined || current.phase === 'complete'
    || current.id !== goal['id'] || current.revision !== goal['revision']) {
    fail('goal/completion-audit does not name the exact current incomplete goal revision')
  }

  const auditor = data['auditor']
  if (!isRecord(auditor)) fail('goal/completion-audit auditor must be a record')
  const auditorKeys = Object.keys(auditor).sort().join(',')
  if (auditorKeys !== 'provider,sessionId,verdict'
    && auditorKeys !== 'model,modelProvider,provider,sessionId,verdict') {
    fail('goal/completion-audit auditor has an invalid field set')
  }
  if (typeof auditor['provider'] !== 'string' || auditor['provider'].trim().length === 0
    || auditor['provider'] !== auditor['provider'].trim()) {
    fail('goal/completion-audit auditor provider must be normalized and non-empty')
  }
  if (typeof auditor['sessionId'] !== 'string' || auditor['sessionId'].trim().length === 0
    || auditor['sessionId'] !== auditor['sessionId'].trim()) {
    fail('goal/completion-audit auditor sessionId must be normalized and non-empty')
  }
  const verdict = auditor['verdict']
  if (!isRecord(verdict)) fail('goal/completion-audit auditor verdict must be a record')
  exactKeys(verdict, ['algorithm', 'digest'], 'goal/completion-audit auditor verdict', fail)
  if (verdict['algorithm'] !== 'sha256'
    || typeof verdict['digest'] !== 'string' || !/^[a-f0-9]{64}$/.test(verdict['digest'])) {
    fail('goal/completion-audit auditor verdict digest is invalid')
  }
  if (auditorKeys !== 'provider,sessionId,verdict'
    && (typeof auditor['modelProvider'] !== 'string' || auditor['modelProvider'].trim().length === 0
      || auditor['modelProvider'] !== auditor['modelProvider'].trim()
      || typeof auditor['model'] !== 'string' || auditor['model'].trim().length === 0
      || auditor['model'] !== auditor['model'].trim())) {
    fail('goal/completion-audit auditor model route must be normalized and complete')
  }

  const evidence = data['evidence']
  if (!isRecord(evidence)) fail('goal/completion-audit evidence must be a record')
  exactKeys(evidence, ['algorithm', 'digest', 'eventCount', 'fromSeq', 'throughSeq'], 'goal/completion-audit evidence', fail)
  const fromSeq = evidence['fromSeq']
  const throughSeq = evidence['throughSeq']
  const eventCount = evidence['eventCount']
  if (!Number.isSafeInteger(fromSeq) || (fromSeq as number) < 0
    || !Number.isSafeInteger(throughSeq) || (throughSeq as number) < (fromSeq as number)
    || !Number.isSafeInteger(eventCount) || eventCount !== (throughSeq as number) - (fromSeq as number) + 1) {
    fail('goal/completion-audit evidence interval is invalid')
  }
  if (throughSeq !== event.seq - 1 || prefix.length !== event.seq) {
    fail('goal/completion-audit must cover the complete committed prefix immediately before itself')
  }
  const created = prefix[fromSeq as number]
  if (created?.type !== 'goal/change' || created.data.operation !== 'create'
    || created.data.goal.id !== goal['id']) {
    fail('goal/completion-audit evidence must start at the named goal creation event')
  }
  if (evidence['algorithm'] !== 'sha256'
    || typeof evidence['digest'] !== 'string' || !/^[a-f0-9]{64}$/.test(evidence['digest'])) {
    fail('goal/completion-audit evidence digest is invalid')
  }
  const inspected = prefix.slice(fromSeq as number, throughSeq + 1)
  if (completionEvidenceDigest(inspected) !== evidence['digest']) {
    fail('goal/completion-audit evidence digest does not match committed history')
  }
  if (!Number.isSafeInteger(data['completedTodoCount']) || (data['completedTodoCount'] as number) < 0) {
    fail('goal/completion-audit completedTodoCount must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(data['auditedAt']) || (data['auditedAt'] as number) < 0) {
    fail('goal/completion-audit auditedAt must be a non-negative safe integer')
  }
}

/** Install strict validation for the package-owned completion receipt. */
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const staged = new WeakMap<SessionEvent, Session>()
  const validateExisting = (session: Session): void => {
    for (const event of session.events) {
      if (event.type !== 'goal/completion-audit') continue
      validateAuditEvent(session.events.slice(0, event.seq), event, fail)
    }
  }
  for (const session of ctx.sessions.list()) validateExisting(session)
  ctx.on('session/created', validateExisting, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'goal/completion-audit') return
    validateAuditEvent(session.events, event, fail)
    staged.set(event, session)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'goal/completion-audit') return
    if (staged.get(event) !== session) fail('goal/completion-audit published without pre-commit validation')
    staged.delete(event)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
