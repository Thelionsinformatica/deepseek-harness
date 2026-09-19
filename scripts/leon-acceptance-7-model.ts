/** Executable evidence registry and fail-closed aggregation for LEON-ACCEPTANCE-7. */

import type { LeonEvalRawRun, LeonEvalTestResult } from './leon-eval-ptbr-model.ts'

/** Stable schema version for the acceptance artifact. */
const LEON_ACCEPTANCE_7_SCHEMA_VERSION = 1 as const

/** Strength of one executable assertion for a product requirement. */
type LeonAcceptanceEvidenceStrength = 'decisive' | 'supporting'

/** One exact Vitest case used as sanitized evidence. */
interface LeonAcceptanceEvidence {
  readonly file: string
  readonly testName: string
  readonly strength: LeonAcceptanceEvidenceStrength
}

/** One user-visible product requirement and its current proof boundary. */
export interface LeonAcceptanceCriterion {
  readonly id: `LEON-ACC-00${number}`
  readonly titlePtBr: string
  readonly critical: boolean
  readonly evidence: readonly LeonAcceptanceEvidence[]
  /** Stable gaps that prevent a supporting proof from being presented as complete. */
  readonly knownGaps: readonly string[]
}

/** Result for one requirement across every repeated run. */
interface LeonAcceptanceCriterionResult {
  readonly id: LeonAcceptanceCriterion['id']
  readonly titlePtBr: string
  readonly critical: boolean
  readonly status: 'passed' | 'partial' | 'failed'
  readonly durationMs: readonly number[]
  readonly missingEvidence: readonly string[]
  readonly failedEvidence: readonly string[]
  readonly knownGaps: readonly string[]
}

/** Sanitized aggregate emitted by the acceptance coordinator. */
export interface LeonAcceptanceReport {
  readonly schemaVersion: typeof LEON_ACCEPTANCE_7_SCHEMA_VERSION
  readonly status: 'passed' | 'failed'
  readonly runCount: number
  readonly minimumRunsMet: boolean
  readonly stable: boolean
  readonly criterionCount: number
  readonly passedCriteria: readonly string[]
  readonly partialCriteria: readonly string[]
  readonly failedCriteria: readonly string[]
  readonly criticalFailures: readonly string[]
  readonly missingEvidence: readonly string[]
  readonly criterionResults: readonly LeonAcceptanceCriterionResult[]
}

const RESUME = 'packages/core/agent-loop/tests/resume.spec.ts'
const LONG_HORIZON = 'packages/memory/tool-memory/tests/long-horizon-decision.acceptance.spec.ts'
const UIA = 'apps/cli/tests/leon-windows-uia.spec.ts'
const WORKSPACE = 'packages/workspace/workspace/tests/workspace.spec.ts'
const GOAL = 'packages/goal/tool-goal/tests/tool-goal.spec.ts'
const GOAL_INVARIANT = 'packages/goal/tool-goal/tests/invariant.spec.ts'
const MEMORY_INTEGRATION = 'packages/memory/tool-memory/tests/integration.spec.ts'
const PROCEDURE_SERVICE = 'packages/memory/tool-memory/tests/procedure-learning.acceptance.spec.ts'
const PROCEDURE_TOOLS = 'packages/memory/tool-memory/tests/procedure-tools.acceptance.spec.ts'
const ROUTING = 'packages/host/apiproxy/tests/leon-acc-006-routing-policy.spec.ts'
const LOCAL_REAL = 'packages/host/apiproxy/tests/leon-acc-006-local-real.acceptance.spec.ts'
const COST = 'packages/session/session-stats/tests/projection.spec.ts'
const COST_UI = 'packages/client/ui-conversation/tests/chat-stats.client.spec.tsx'

function proof(
  file: string,
  testName: string,
  strength: LeonAcceptanceEvidenceStrength = 'decisive',
): LeonAcceptanceEvidence {
  return { file, testName, strength }
}

/** Canonical seven requirements requested for Leon's product acceptance. */
export const LEON_ACCEPTANCE_7_CRITERIA: readonly LeonAcceptanceCriterion[] = [
  {
    id: 'LEON-ACC-001',
    titlePtBr: 'Retomar uma tarefa após reiniciar e trocar de modelo',
    critical: true,
    evidence: [proof(RESUME, 'resumes one pending task after a runtime restart while switching the selected model')],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-002',
    titlePtBr: 'Encontrar corretamente uma decisão tomada meses antes',
    critical: true,
    evidence: [proof(
      LONG_HORIZON,
      'recovers the correct 150-day-old decision ahead of recent distractors in a new session',
    )],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-003',
    titlePtBr: 'Operar o ambiente sem confundir janelas ou projetos',
    critical: true,
    evidence: [
      proof(UIA, 'changes only the exact inspected window when two accessible windows look identical'),
      proof(WORKSPACE, 'requires both candidate id and matching canonical cwd without re-reading on list()'),
      proof(WORKSPACE, 'rejects duplicate candidate ownership, duplicate paths, and initialized order drift'),
    ],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-004',
    titlePtBr: 'Testar e comprovar alterações antes de declarar conclusão',
    critical: true,
    evidence: [
      proof(GOAL, 'refuses Leon completion until the current goal has a non-empty all-completed task list', 'supporting'),
      proof(GOAL, 'commits completion only after a fresh structured auditor passes'),
      proof(GOAL, 'invalidates a passing audit when the parent session changes during review'),
      proof(GOAL, 'keeps the goal active, returns findings, and permits a corrected retry', 'supporting'),
      proof(GOAL, 'fails closed on invalid audit output and bounds auditor starts per turn', 'supporting'),
      proof(GOAL_INVARIANT, 'rejects a tampered digest before durable publication'),
    ],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-005',
    titlePtBr: 'Aprender um procedimento validado e reutilizá-lo',
    critical: false,
    evidence: [
      proof(
        PROCEDURE_TOOLS,
        'learns reviewed successful tool evidence and reuses exact steps after a model switch',
      ),
      proof(
        PROCEDURE_SERVICE,
        'promotes only after review, survives a service restart, and reuses exact steps only with matching preconditions',
        'supporting',
      ),
      proof(
        PROCEDURE_SERVICE,
        'withholds procedures when revalidation is due, marks a failed check stale, and reactivates only after a successful check',
        'supporting',
      ),
      proof(
        MEMORY_INTEGRATION,
        'reuses a human-reviewed procedure in a later session and validates the exact tool arguments',
        'supporting',
      ),
    ],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-006',
    titlePtBr: 'Usar majoritariamente modelos locais em tarefas representativas',
    critical: false,
    evidence: [
      proof(
        ROUTING,
        'classifica 30 tarefas PT-BR e mantém toda seleção inicial em Ollama/Qwen ou Ollama/Ornith',
        'supporting',
      ),
      proof(
        ROUTING,
        'prova que a sentinela offline reprova uma rota externa antes de qualquer adaptador',
        'supporting',
      ),
      proof(LOCAL_REAL, 'executa e valida 30 tarefas locais com evidência sanitizada'),
    ],
    knownGaps: [],
  },
  {
    id: 'LEON-ACC-007',
    titlePtBr: 'Mostrar separadamente custo confirmado, estimado e não contabilizado',
    critical: true,
    evidence: [
      proof(COST, 'prices exact routes, counts local zero-cost calls, and replaces a stream sample with final usage'),
      proof(COST, 'marks a usage-bearing route absent from the table instead of hiding it inside a false total'),
      proof(COST, 'prefers an exact gateway-reported charge and treats an explicit zero as priced'),
      proof(COST, 'separates calls without usage from failed attempts without cost evidence'),
      proof(COST, 'keeps usage from a failed attempt separate from final usage in the same step'),
      proof(COST, 'counts a no-usage failover attempt separately from its estimated replacement call'),
      proof(COST, 'preserves a confirmed partial charge when failover replacement usage is estimated'),
      proof(COST_UI, 'shows token-estimated cost separately from calls without cost evidence'),
      proof(COST_UI, 'distinguishes confirmed, estimated, and unaccounted billing facts'),
      proof(COST_UI, 'keeps the legacy aggregate display for projections created before separated accounting'),
    ],
    knownGaps: [],
  },
]

/** Unique test modules required by the canonical criteria. */
export function leonAcceptance7TestFiles(
  criteria: readonly LeonAcceptanceCriterion[] = LEON_ACCEPTANCE_7_CRITERIA,
): string[] {
  return [...new Set(criteria.flatMap(item => item.evidence.map(entry => entry.file)))].sort()
}

/** Aggregate repeated sanitized Vitest output; any missing, skipped, or unstable evidence fails closed. */
export function aggregateLeonAcceptance7(
  runs: readonly LeonEvalRawRun[],
  criteria: readonly LeonAcceptanceCriterion[] = LEON_ACCEPTANCE_7_CRITERIA,
  minimumRuns = 3,
): LeonAcceptanceReport {
  const evaluated = runs.map(run => indexRun(run))
  const criterionResults = criteria.map((criterion): LeonAcceptanceCriterionResult => {
    const missingEvidence = new Set<string>()
    const failedEvidence = new Set<string>()
    const durations: number[] = []
    for (const run of evaluated) {
      for (const expected of criterion.evidence) {
        const key = evidenceKey(expected.file, expected.testName)
        const observed = run.get(key)
        if (observed === undefined || observed.state === 'skipped' || observed.state === 'pending') {
          missingEvidence.add(key)
          continue
        }
        durations.push(observed.durationMs)
        if (observed.state !== 'passed') failedEvidence.add(key)
      }
    }
    if (evaluated.length < minimumRuns) {
      for (const expected of criterion.evidence) missingEvidence.add(evidenceKey(expected.file, expected.testName))
    }
    const allExecutablePassed = missingEvidence.size === 0 && failedEvidence.size === 0
    const hasDecisiveEvidence = criterion.evidence.some(entry => entry.strength === 'decisive')
    const status = !allExecutablePassed
      ? 'failed'
      : criterion.knownGaps.length > 0 || !hasDecisiveEvidence ? 'partial' : 'passed'
    return {
      id: criterion.id,
      titlePtBr: criterion.titlePtBr,
      critical: criterion.critical,
      status,
      durationMs: durations,
      missingEvidence: [...missingEvidence].sort(),
      failedEvidence: [...failedEvidence].sort(),
      knownGaps: criterion.knownGaps,
    }
  })
  const statusesByRun = runs.map(run => run.reason)
  const stable = runs.length >= minimumRuns
    && statusesByRun.every(reason => reason === statusesByRun[0])
    && criterionResults.every(result => result.failedEvidence.length === 0 && result.missingEvidence.length === 0)
  const failedCriteria = criterionResults.filter(item => item.status === 'failed').map(item => item.id)
  const partialCriteria = criterionResults.filter(item => item.status === 'partial').map(item => item.id)
  const passedCriteria = criterionResults.filter(item => item.status === 'passed').map(item => item.id)
  const criticalFailures = criterionResults
    .filter(item => item.critical && item.status !== 'passed')
    .map(item => item.id)
  const minimumRunsMet = runs.length >= minimumRuns
  return {
    schemaVersion: LEON_ACCEPTANCE_7_SCHEMA_VERSION,
    status: minimumRunsMet && stable && failedCriteria.length === 0 && partialCriteria.length === 0
      ? 'passed'
      : 'failed',
    runCount: runs.length,
    minimumRunsMet,
    stable,
    criterionCount: criteria.length,
    passedCriteria,
    partialCriteria,
    failedCriteria,
    criticalFailures,
    missingEvidence: criterionResults.flatMap(item => item.missingEvidence).sort(),
    criterionResults,
  }
}

function indexRun(run: LeonEvalRawRun): ReadonlyMap<string, LeonEvalTestResult> {
  return new Map(run.tests.map(test => [evidenceKey(test.file, test.testName), test]))
}

function evidenceKey(file: string, testName: string): string {
  return `${normalizePath(file)}::${testName}`
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '')
}
