/**
 * Host-side durable learning of reviewed, workspace-scoped procedures.
 * @module @deepseek-ai/dsh-tool-memory/procedure-learning
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import type { KvRecordMutation, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { looksSensitive } from './sensitivity.ts'
import { procedureLearningDomainSpec } from './spec.ts'
import {
  ProcedureId,
  type BlockedProcedureReuse,
  type ProcedureEvidence,
  type ProcedureLearningFailure,
  type ProcedureLearningResult,
  type ProcedureInspectRequest,
  type ProcedurePrecondition,
  type ProcedureProposalRequest,
  type ProcedureRecord,
  type ProcedureRevalidationRequest,
  type ProcedureReuseBlockReason,
  type ProcedureReuseRequest,
  type ProcedureReuseResult,
  type ProcedureReviewRequest,
  type ProcedureRevokeRequest,
  type ProcedureToolObservation,
  type ProcedureValidity,
} from './procedure-contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    procedureLearning: ProcedureLearningService
  }
}

const MAX_TITLE_CHARS = 160
const MAX_TRIGGER_CHARS = 500
const MAX_PRECONDITIONS = 16
const MAX_STEPS = 32
const MAX_TOOL_NAME_CHARS = 128
const MAX_ARGUMENT_CHARS = 16_384
const DEFAULT_REUSE_LIMIT = 8
const MAX_REUSE_LIMIT = 50
const SHA256_PATTERN = /^[a-f\d]{64}$/u
const PRECONDITION_KEY_PATTERN = /^[\w.-]{1,64}$/u

/** Deployment-owned identity attached to every review and revocation. */
export interface ProcedureLearningConfig {
  readonly reviewedBy: string
}

interface NormalizedObservation extends ProcedureToolObservation {
  readonly arguments: JsonValue
}

interface NormalizedProposal {
  readonly title: string
  readonly trigger: string
  readonly preconditions: readonly ProcedurePrecondition[]
  readonly executions: readonly NormalizedObservation[]
  readonly verification: NormalizedObservation
  readonly validity: ProcedureValidity
}

interface ExistingProcedureMutationRequest {
  readonly workspaceId: ProcedureRecord['workspaceId']
  readonly id: ProcedureId
  readonly expectedRevision: number
}

type ProposalValidation =
  | { readonly ok: true; readonly value: NormalizedProposal }
  | { readonly ok: false; readonly error: ProcedureLearningFailure }

/** Durable service that promotes only verified trajectories after explicit host review. */
export class ProcedureLearningService extends Service {
  static inject = ['storageDomain']

  /** Loader validation for the deployment-owned reviewer label. */
  static Config: s<ProcedureLearningConfig> = s.object({
    reviewedBy: s.string().required(),
  })

  private table?: KvTable<ProcedureId, ProcedureRecord>
  private readonly reviewedBy: string

  /**
   * @param ctx - Host context carrying the durable domain facility.
   * @param config - Deployment-owned reviewer identity.
   */
  constructor(ctx: Context, config: ProcedureLearningConfig) {
    super(ctx, 'procedureLearning')
    this.reviewedBy = normalizeReviewer(config.reviewedBy)
  }

  /** Open and own the durable procedure domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(procedureLearningDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'procedure-learning.domainClose')
    this.table = domain.table('procedures')
  }

  /**
   * Persist a review candidate derived only from successful host-observed tool calls.
   * Failed observations, credential-like arguments, duplicate call ids, and invalid
   * validity windows are rejected before durable state changes.
   * @param request - Complete successful trajectory plus independent verification.
   * @returns The candidate record or a stable validation failure.
   */
  async propose(request: ProcedureProposalRequest): Promise<ProcedureLearningResult> {
    const proposedAt = new Date().toISOString()
    const checked = validateProposal(request, proposedAt)
    if (!checked.ok) return rejected(checked.error)
    const proposal = checked.value
    const evidence = initialEvidence(proposal)
    const recordBase = {
      workspaceId: request.workspaceId,
      revision: 1,
      title: proposal.title,
      trigger: proposal.trigger,
      preconditions: proposal.preconditions,
      steps: proposal.executions.map(observation => Object.freeze({
        tool: observation.tool,
        arguments: observation.arguments,
      })),
      verifier: Object.freeze({
        tool: proposal.verification.tool,
        arguments: proposal.verification.arguments,
      }),
      validity: proposal.validity,
      status: 'candidate',
      evidence: Object.freeze([evidence]),
      proposedAt,
      updatedAt: proposedAt,
      schemaVersion: 1,
    } as const
    const table = this.requireTable()
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = ProcedureId(randomUUID())
      const record = immutableRecord({ id, ...recordBase } satisfies ProcedureRecord)
      const inserted = await table.mutate(id, current => current === undefined
        ? { kind: 'put', value: record, result: true }
        : { kind: 'keep', result: false })
      if (inserted) return success(record)
    }
    throw new Error('procedure-learning: could not allocate a unique procedure id')
  }

  /**
   * Return one exact same-workspace record for operator inspection in any lifecycle state.
   * Cross-workspace and missing ids share the same not-found result.
   * @param request - Workspace boundary and opaque procedure id.
   * @returns A detached record or the stable not-found branch.
   */
  inspect(request: ProcedureInspectRequest): ProcedureLearningResult {
    const current = this.requireTable().get(request.id)
    if (current === undefined || current.workspaceId !== request.workspaceId) {
      return rejected(notFound(request.id))
    }
    return success(immutableRecord(current))
  }

  /**
   * Promote or reject one exact candidate revision after explicit operator review.
   * Acceptance fails once revalidation is due or the validity window has expired.
   * @param request - Workspace, exact revision, and immutable review decision.
   * @returns The committed next revision or a stable business failure.
   */
  review(request: ProcedureReviewRequest): Promise<ProcedureLearningResult> {
    const now = new Date().toISOString()
    return this.mutateExisting(request, (admitted) => {
      if (admitted.status !== 'candidate') {
        return { kind: 'keep', result: rejected(invalidState(request.id, admitted.status)) }
      }
      if (request.decision === 'accept') {
        if (Date.parse(now) >= Date.parse(admitted.validity.revalidateAfter)
          || Date.parse(now) >= Date.parse(admitted.validity.validUntil)) {
          return { kind: 'keep', result: rejected({ code: 'procedure-validity-expired', id: request.id }) }
        }
      }
      const next = immutableRecord({
        ...admitted,
        revision: admitted.revision + 1,
        status: request.decision === 'accept' ? 'validated' : 'rejected',
        reviewedAt: now,
        reviewedBy: this.reviewedBy,
        ...(request.decision === 'accept'
          ? { lastValidatedAt: admitted.evidence[0]?.recordedAt ?? admitted.proposedAt }
          : {}),
        updatedAt: now,
      } satisfies ProcedureRecord)
      return { kind: 'put', value: next, result: success(next) }
    })
  }

  /**
   * Return relevant validated procedures only when their exact preconditions and
   * validity windows admit reuse. Candidate, rejected, and revoked rows stay hidden.
   * @param request - Workspace query, current environment facts, and result bound.
   * @returns Reusable rows plus relevant rows withheld for an actionable reason.
   */
  findReusable(request: ProcedureReuseRequest): ProcedureReuseResult {
    const query = request.query.trim()
    if (query.length === 0) return Object.freeze({ items: Object.freeze([]), blocked: Object.freeze([]) })
    const now = Date.now()
    const limit = resolveReuseLimit(request.limit)
    const queryTokens = tokens(query)
    const candidates = [...this.requireTable().entries()]
      .map(([, record]) => record)
      .filter(record => record.workspaceId === request.workspaceId)
      .map(record => ({ record, score: relevance(queryTokens, record) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score
        || right.record.updatedAt.localeCompare(left.record.updatedAt)
        || String(left.record.id).localeCompare(String(right.record.id)))
    const items: ProcedureRecord[] = []
    const blocked: BlockedProcedureReuse[] = []
    for (const { record } of candidates) {
      if (record.status === 'candidate' || record.status === 'rejected' || record.status === 'revoked') continue
      const reason = reuseBlockReason(record, request.preconditions, now)
      if (reason === undefined) {
        if (items.length < limit) items.push(immutableRecord(record))
      } else {
        blocked.push(Object.freeze({
          id: record.id,
          revision: record.revision,
          reason,
          verifier: record.verifier,
        }))
      }
    }
    return Object.freeze({
      items: Object.freeze(items),
      blocked: Object.freeze(blocked),
    })
  }

  /**
   * Commit one verifier outcome for an exact validated or stale revision. A failed
   * verifier marks the procedure stale; a successful verifier requires a fresh
   * validity window and can reactivate a stale procedure.
   * @param request - Exact revision, current preconditions, verifier observation, and optional new validity.
   * @returns The committed next revision or a stable business failure.
   */
  revalidate(request: ProcedureRevalidationRequest): Promise<ProcedureLearningResult> {
    const now = new Date().toISOString()
    return this.mutateExisting(request, (admitted) => {
      if (admitted.status !== 'validated' && admitted.status !== 'stale') {
        return { kind: 'keep', result: rejected(invalidState(request.id, admitted.status)) }
      }
      if (!preconditionsMatch(admitted.preconditions, request.preconditions)) {
        return {
          kind: 'keep',
          result: rejected({ code: 'procedure-precondition-mismatch', id: request.id }),
        }
      }
      const verification = normalizeObservation(request.verification)
      if (verification === undefined
        || verification.tool !== admitted.verifier.tool
        || canonicalJson(verification.arguments) !== canonicalJson(admitted.verifier.arguments)
        || Date.parse(verification.observedAt) < Date.parse(admitted.updatedAt)) {
        return {
          kind: 'keep',
          result: rejected({ code: 'procedure-invalid-proposal', reason: 'invalid-revalidation-evidence' }),
        }
      }
      let validity = admitted.validity
      if (verification.succeeded) {
        const checkedValidity = normalizeValidity(request.validity, verification.observedAt, now)
        if (checkedValidity === undefined) {
          return {
            kind: 'keep',
            result: rejected({ code: 'procedure-invalid-proposal', reason: 'invalid-validity-window' }),
          }
        }
        validity = checkedValidity
      }
      const evidence = revalidationEvidence(verification)
      const { staleAt: _staleAt, ...withoutStaleAt } = admitted
      const next = immutableRecord({
        ...withoutStaleAt,
        revision: admitted.revision + 1,
        validity,
        status: verification.succeeded ? 'validated' : 'stale',
        evidence: Object.freeze([...admitted.evidence, evidence]),
        ...(verification.succeeded
          ? { lastValidatedAt: verification.observedAt }
          : { staleAt: verification.observedAt }),
        updatedAt: now,
      } satisfies ProcedureRecord)
      return { kind: 'put', value: next, result: success(next) }
    })
  }

  /**
   * Revoke one exact candidate, validated, or stale revision. Rejected and already
   * revoked rows are immutable terminal states.
   * @param request - Workspace and exact procedure revision.
   * @returns The committed revoked revision or a stable business failure.
   */
  revoke(request: ProcedureRevokeRequest): Promise<ProcedureLearningResult> {
    const now = new Date().toISOString()
    return this.mutateExisting(request, (admitted) => {
      if (admitted.status === 'rejected' || admitted.status === 'revoked') {
        return { kind: 'keep', result: rejected(invalidState(request.id, admitted.status)) }
      }
      const next = immutableRecord({
        ...admitted,
        revision: admitted.revision + 1,
        status: 'revoked',
        reviewedBy: this.reviewedBy,
        revokedAt: now,
        updatedAt: now,
      } satisfies ProcedureRecord)
      return { kind: 'put', value: next, result: success(next) }
    })
  }

  /** Apply one revision-checked transition on the table's atomic mutation queue. */
  private mutateExisting(
    request: ExistingProcedureMutationRequest,
    transition: (record: ProcedureRecord) => KvRecordMutation<ProcedureRecord, ProcedureLearningResult>,
  ): Promise<ProcedureLearningResult> {
    return this.requireTable().mutate(request.id, (current) => {
      const admission = mutationAdmission(current, request.workspaceId, request.id, request.expectedRevision)
      return admission.ok
        ? transition(admission.record)
        : { kind: 'keep', result: rejected(admission.error) }
    })
  }

  /** Require the initialized procedure table. */
  private requireTable(): KvTable<ProcedureId, ProcedureRecord> {
    if (this.table === undefined) throw new Error('procedure-learning: durable domain is not initialized')
    return this.table
  }
}

export default ProcedureLearningService

/** Validate, detach, and normalize one proposal before persistence. */
function validateProposal(request: ProcedureProposalRequest, now: string): ProposalValidation {
  const title = normalizeText(request.title, MAX_TITLE_CHARS)
  const trigger = normalizeText(request.trigger, MAX_TRIGGER_CHARS)
  if (title === undefined || trigger === undefined) return invalidProposal('invalid-title-or-trigger')
  if (request.preconditions.length > MAX_PRECONDITIONS) return invalidProposal('too-many-preconditions')
  if (request.executions.length === 0 || request.executions.length > MAX_STEPS) {
    return invalidProposal('invalid-execution-count')
  }
  const preconditions = normalizePreconditions(request.preconditions)
  if (preconditions === undefined) return invalidProposal('invalid-preconditions')
  const executions = request.executions.map(normalizeObservation)
  const verification = normalizeObservation(request.verification)
  if (executions.some(observation => observation === undefined) || verification === undefined) {
    return invalidProposal('invalid-tool-observation')
  }
  const normalizedExecutions = executions as NormalizedObservation[]
  if (!normalizedExecutions.every(observation => observation.succeeded) || !verification.succeeded) {
    return invalidProposal('trajectory-not-successful')
  }
  const sessionId = verification.sessionId
  const observations = [...normalizedExecutions, verification]
  if (!observations.every(observation => observation.sessionId === sessionId)) {
    return invalidProposal('mixed-session-evidence')
  }
  const callIds = observations.map(observation => observation.callId)
  if (new Set(callIds).size !== callIds.length) return invalidProposal('duplicate-call-id')
  const verificationAt = Date.parse(verification.observedAt)
  if (normalizedExecutions.some(observation => Date.parse(observation.observedAt) > verificationAt)) {
    return invalidProposal('verification-before-execution')
  }
  const validity = normalizeValidity(request.validity, verification.observedAt, now)
  if (validity === undefined) return invalidProposal('invalid-validity-window')
  if (containsSensitiveProcedure(title, trigger, preconditions, observations)) {
    return { ok: false, error: { code: 'procedure-sensitive-content' } }
  }
  return {
    ok: true,
    value: Object.freeze({
      title,
      trigger,
      preconditions: Object.freeze(preconditions),
      executions: Object.freeze(normalizedExecutions),
      verification,
      validity,
    }),
  }
}

/** Normalize exact environment preconditions and reject duplicate keys. */
function normalizePreconditions(values: readonly ProcedurePrecondition[]): ProcedurePrecondition[] | undefined {
  const seen = new Set<string>()
  const normalized: ProcedurePrecondition[] = []
  for (const value of values) {
    const key = value.key.trim()
    const expected = value.expected.trim()
    if (!PRECONDITION_KEY_PATTERN.test(key) || expected.length === 0 || expected.length > 256 || seen.has(key)) {
      return undefined
    }
    seen.add(key)
    normalized.push(Object.freeze({ key, expected }))
  }
  return normalized
}

/** Detach lossless JSON and normalize one host observation. */
function normalizeObservation(value: ProcedureToolObservation): NormalizedObservation | undefined {
  const tool = value.tool.trim()
  const observedAt = normalizeInstant(value.observedAt)
  const argumentsSnapshot = snapshotJsonValue(value.arguments)
  if (tool.length === 0 || tool.length > MAX_TOOL_NAME_CHARS
    || observedAt === undefined
    || argumentsSnapshot === undefined
    || canonicalJson(argumentsSnapshot).length > MAX_ARGUMENT_CHARS
    || !SHA256_PATTERN.test(value.resultDigest)) return undefined
  return Object.freeze({
    ...value,
    tool,
    arguments: argumentsSnapshot,
    resultDigest: value.resultDigest,
    observedAt,
  })
}

/** Normalize a validity window relative to both its evidence and commit time. */
function normalizeValidity(
  value: ProcedureValidity | undefined,
  evidenceAt: string,
  now: string,
): ProcedureValidity | undefined {
  if (value === undefined) return undefined
  const revalidateAfter = normalizeInstant(value.revalidateAfter)
  const validUntil = normalizeInstant(value.validUntil)
  if (revalidateAfter === undefined || validUntil === undefined) return undefined
  const lowerBound = Math.max(Date.parse(evidenceAt), Date.parse(now))
  if (Date.parse(revalidateAfter) <= lowerBound || Date.parse(validUntil) <= Date.parse(revalidateAfter)) return undefined
  return Object.freeze({ revalidateAfter, validUntil })
}

/** Normalize one bounded non-empty text field. */
function normalizeText(value: string, maxChars: number): string | undefined {
  const normalized = value.trim()
  return normalized.length === 0 || normalized.length > maxChars ? undefined : normalized
}

/** Normalize one parseable instant to canonical ISO-8601. */
function normalizeInstant(value: string): string | undefined {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}

/** Return whether any retained procedure field resembles a credential. */
function containsSensitiveProcedure(
  title: string,
  trigger: string,
  preconditions: readonly ProcedurePrecondition[],
  observations: readonly NormalizedObservation[],
): boolean {
  const values = [
    title,
    trigger,
    ...preconditions.flatMap(precondition => [precondition.key, precondition.expected]),
    ...observations.flatMap(observation => [observation.tool, canonicalJson(observation.arguments)]),
  ]
  return values.some(looksSensitive)
}

/** Build content-free evidence for the initially successful trajectory. */
function initialEvidence(proposal: NormalizedProposal): ProcedureEvidence {
  return Object.freeze({
    kind: 'initial-validation',
    sessionId: proposal.verification.sessionId,
    executionCallIds: Object.freeze(proposal.executions.map(observation => observation.callId)),
    verificationCallId: proposal.verification.callId,
    resultDigests: Object.freeze([
      ...proposal.executions.map(observation => observation.resultDigest),
      proposal.verification.resultDigest,
    ]),
    succeeded: true,
    recordedAt: proposal.verification.observedAt,
  })
}

/** Build content-free evidence for one verifier-only revalidation. */
function revalidationEvidence(verification: NormalizedObservation): ProcedureEvidence {
  return Object.freeze({
    kind: 'revalidation',
    sessionId: verification.sessionId,
    executionCallIds: Object.freeze([]),
    verificationCallId: verification.callId,
    resultDigests: Object.freeze([verification.resultDigest]),
    succeeded: verification.succeeded,
    recordedAt: verification.observedAt,
  })
}

/** Hide cross-workspace existence behind the same not-found failure. */
function mutationAdmission(
  current: ProcedureRecord | undefined,
  workspaceId: ProcedureRecord['workspaceId'],
  id: ProcedureId,
  expectedRevision: number,
): { readonly ok: true; readonly record: ProcedureRecord }
  | { readonly ok: false; readonly error: ProcedureLearningFailure } {
  if (current === undefined || current.workspaceId !== workspaceId) return { ok: false, error: notFound(id) }
  if (current.revision !== expectedRevision) {
    return {
      ok: false,
      error: { code: 'procedure-revision-conflict', id, currentRevision: current.revision },
    }
  }
  return { ok: true, record: current }
}

/** Return whether every declared precondition matches the observed environment. */
function preconditionsMatch(
  required: readonly ProcedurePrecondition[],
  observed: Readonly<Record<string, string>>,
): boolean {
  return required.every(precondition => observed[precondition.key] === precondition.expected)
}

/** Return the first reason a relevant procedure cannot be reused. */
function reuseBlockReason(
  record: ProcedureRecord,
  observed: Readonly<Record<string, string>>,
  now: number,
): ProcedureReuseBlockReason | undefined {
  if (record.status === 'stale') return 'stale'
  if (now >= Date.parse(record.validity.validUntil)) return 'expired'
  if (now >= Date.parse(record.validity.revalidateAfter)) return 'revalidation-required'
  if (!preconditionsMatch(record.preconditions, observed)) return 'precondition-mismatch'
  return undefined
}

/** Resolve and bound a caller-supplied reuse count. */
function resolveReuseLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_REUSE_LIMIT
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REUSE_LIMIT) return DEFAULT_REUSE_LIMIT
  return value
}

/** Tokenize one PT-BR phrase for deterministic lexical matching. */
function tokens(value: string): ReadonlySet<string> {
  const normalized = value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
  return new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
}

/** Score query-token coverage against the title and trigger. */
function relevance(query: ReadonlySet<string>, record: ProcedureRecord): number {
  if (query.size === 0) return 0
  const candidate = tokens(`${record.title} ${record.trigger}`)
  let overlap = 0
  for (const token of query) if (candidate.has(token)) overlap += 1
  return overlap / query.size
}

/** Stable canonical JSON for argument identity and size checks. */
function canonicalJson(value: JsonValue): string {
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
    return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)))
  })
}

/** Validate the configured reviewer label once at service construction. */
function normalizeReviewer(value: string): string {
  const normalized = value.trim()
  if (!/^[\w.@-]{1,128}$/u.test(normalized)) {
    throw new TypeError('procedure-learning: reviewedBy must contain 1-128 safe label characters')
  }
  return normalized
}

/** Return a frozen success branch. */
function success(value: ProcedureRecord): ProcedureLearningResult {
  return Object.freeze({ ok: true, value })
}

/** Return a frozen failure branch. */
function rejected(error: ProcedureLearningFailure): ProcedureLearningResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Return one invalid-proposal failure without persisting caller text. */
function invalidProposal(reason: string): ProposalValidation {
  return { ok: false, error: { code: 'procedure-invalid-proposal', reason } }
}

/** Return a not-found failure shared by missing and cross-workspace records. */
function notFound(id: ProcedureId): ProcedureLearningFailure {
  return { code: 'procedure-not-found', id }
}

/** Return a terminal-state failure for an exact record. */
function invalidState(id: ProcedureId, status: ProcedureRecord['status']): ProcedureLearningFailure {
  return { code: 'procedure-invalid-state', id, status }
}

/** Detach and recursively freeze a durable record before storage or return. */
function immutableRecord(record: ProcedureRecord): ProcedureRecord {
  const snapshot = structuredClone(record)
  const pending: object[] = [snapshot]
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) pending.push(value)
    }
    Object.freeze(current)
  }
  return snapshot
}
