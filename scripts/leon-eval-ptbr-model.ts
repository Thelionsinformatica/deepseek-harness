/** Deterministic scenario registry and aggregation for LEON-EVAL-PTBR. */

/** Stable schema version for raw and aggregate evaluation reports. */
export const LEON_EVAL_SCHEMA_VERSION = 1 as const

/** One observable behavior class measured by the evaluation. */
type LeonEvalCategory =
  | 'continuity'
  | 'explicit-memory'
  | 'automatic-memory'
  | 'semantic-retrieval'
  | 'correction'
  | 'forgetting'
  | 'workspace-isolation'
  | 'user-isolation'
  | 'privacy'
  | 'cloud-consent'
  | 'prompt-injection'
  | 'routing'

/** Metric families derived from scenario outcomes. */
type LeonEvalMetricTag =
  | 'oracle'
  | 'recall'
  | 'false-positive'
  | 'workspace-leakage'
  | 'user-leakage'
  | 'sensitive-leakage'
  | 'confirmation'
  | 'rejection'
  | 'cloud-consent'
  | 'prompt-injection'

/** Exact keyless test that proves one part of a scenario. */
interface LeonEvalEvidence {
  readonly file: string
  readonly testName: string
}

/** One PT-BR evaluation scenario and its executable evidence. */
export interface LeonEvalScenario {
  readonly id: string
  readonly titlePtBr: string
  readonly category: LeonEvalCategory
  readonly critical: boolean
  readonly metrics: readonly LeonEvalMetricTag[]
  readonly evidence: readonly LeonEvalEvidence[]
}

/** Reporter result for one executed Vitest case. */
export interface LeonEvalTestResult {
  readonly file: string
  readonly testName: string
  readonly state: 'passed' | 'failed' | 'skipped' | 'pending'
  readonly durationMs: number
  readonly heapBytes?: number
}

/** Content-free report emitted by one Vitest evaluation run. */
export interface LeonEvalRawRun {
  readonly schemaVersion: typeof LEON_EVAL_SCHEMA_VERSION
  readonly reason: 'passed' | 'failed' | 'interrupted'
  readonly rssBytes: number
  readonly tests: readonly LeonEvalTestResult[]
}

/** One scenario outcome across all baseline repetitions. */
interface LeonEvalScenarioResult {
  readonly id: string
  readonly titlePtBr: string
  readonly category: LeonEvalCategory
  readonly critical: boolean
  readonly passed: boolean
  readonly durationMs: readonly number[]
  readonly heapBytes: readonly number[]
  readonly missingEvidence: readonly string[]
}

/** Numeric summary calculated from repeated keyless runs. */
export interface LeonEvalAggregateReport {
  readonly schemaVersion: typeof LEON_EVAL_SCHEMA_VERSION
  readonly status: 'passed' | 'failed'
  readonly runCount: number
  readonly scenarioCount: number
  readonly minimumRunsMet: boolean
  readonly stable: boolean
  readonly failedScenarios: readonly string[]
  readonly criticalFailures: readonly string[]
  readonly missingEvidence: readonly string[]
  readonly scenarioResults: readonly LeonEvalScenarioResult[]
  readonly metrics: {
    readonly oraclePrecision: number
    readonly recallAtK: number
    readonly falseDiscoveryRate: number
    readonly recallFalsePositiveRate: number
    readonly crossWorkspaceLeakageRate: number
    readonly crossUserLeakageRate: number
    readonly sensitiveDataLeakageRate: number
    readonly confirmationRate: number
    readonly rejectionRate: number
    readonly cloudConsentComplianceRate: number
    readonly promptInjectionRejectionRate: number
  }
  readonly latencyMs: {
    readonly p50: number
    readonly p95: number
    readonly targetP95: number
    readonly withinTarget: boolean
  }
  readonly heapBytes: {
    readonly samples: number
    readonly p50: number
    readonly p95: number
    readonly targetP95: number
    readonly withinTarget: boolean
  }
  readonly processRssBytes: {
    readonly p50: number
    readonly p95: number
  }
}

/** Aggregation thresholds for one evaluation invocation. */
export interface LeonEvalAggregateOptions {
  readonly minimumRuns?: number
  readonly targetP95Ms?: number
  readonly targetHeapP95Bytes?: number
}

const TOOL_INTEGRATION = 'packages/memory/tool-memory/tests/integration.spec.ts'
const TOOL_EXTRACTOR = 'packages/memory/tool-memory/tests/extractor.spec.ts'
const TOOL_COMPOSER = 'packages/memory/tool-memory/tests/context-composer.spec.ts'
const TOOL_LOADER = 'packages/memory/tool-memory/tests/loader-composition.spec.ts'
const MEMORY_LOCAL = 'packages/memory/memory-local/tests/memory-local.spec.ts'
const ADAPTIVE_MODEL = 'packages/host/apiproxy/tests/adaptive-model.spec.ts'
const WEB_APP = 'packages/bundle/web-app/tests/web-app.spec.ts'

function evidence(file: string, testName: string): LeonEvalEvidence {
  return { file, testName }
}

function scenario(
  id: number,
  titlePtBr: string,
  category: LeonEvalCategory,
  metrics: readonly LeonEvalMetricTag[],
  entries: readonly LeonEvalEvidence[],
  critical = false,
): LeonEvalScenario {
  return {
    id: `LEON-MEM-${id.toString().padStart(3, '0')}`,
    titlePtBr,
    category,
    critical,
    metrics,
    evidence: entries,
  }
}

/** Canonical executable scenario set for the Memory V2 phase gate. */
export const LEON_EVAL_SCENARIOS: readonly LeonEvalScenario[] = [
  scenario(1, 'Lembrar e recuperar na mesma sessão', 'explicit-memory', ['oracle', 'recall'], [
    evidence(TOOL_INTEGRATION, 'lets the model retain and retrieve one workspace fact without any API key'),
  ]),
  scenario(2, 'Continuar a memória em uma nova sessão do mesmo projeto', 'continuity', ['oracle', 'recall'], [
    evidence(TOOL_INTEGRATION, 'recalls an explicit memory from a second session in the same workspace'),
  ]),
  scenario(3, 'Preservar a memória após reiniciar o provedor local', 'continuity', ['oracle', 'recall'], [
    evidence(MEMORY_LOCAL, 'reopens the same durable records after the provider lifecycle restarts'),
  ]),
  scenario(4, 'Impedir leitura e mutação entre projetos', 'workspace-isolation', [
    'oracle', 'workspace-leakage',
  ], [evidence(MEMORY_LOCAL, 'never returns or mutates a record through another workspace scope')], true),
  scenario(5, 'Impedir gravação automática para outro usuário', 'user-isolation', ['oracle', 'user-leakage'], [
    evidence(TOOL_INTEGRATION, 'requires both workspace and user flags before an approved candidate can be stored'),
  ], true),
  scenario(6, 'Corrigir uma revisão exata com controle otimista', 'correction', ['oracle'], [
    evidence(MEMORY_LOCAL, 'creates, searches accent-insensitively, corrects by revision, and forgets'),
  ]),
  scenario(7, 'Recusar conflito de revisão obsoleta', 'correction', ['oracle', 'rejection'], [
    evidence(MEMORY_LOCAL, 'creates, searches accent-insensitively, corrects by revision, and forgets'),
  ]),
  scenario(8, 'Esquecer uma memória confirmada', 'forgetting', ['oracle'], [
    evidence(MEMORY_LOCAL, 'creates, searches accent-insensitively, corrects by revision, and forgets'),
  ]),
  scenario(9, 'Recusar credencial em memory_remember', 'privacy', ['oracle', 'sensitive-leakage', 'rejection'], [
    evidence(TOOL_INTEGRATION, 'rejects a credential-like value before a memory write reaches the provider'),
  ]),
  scenario(10, 'Recusar credencial durante correção administrativa', 'privacy', [
    'oracle', 'sensitive-leakage', 'rejection',
  ], [evidence(TOOL_INTEGRATION, 'rejects invalid administrative requests and audits provider failures without content')]),
  scenario(11, 'Não registrar texto bruto de credencial pesquisada', 'privacy', [
    'oracle', 'sensitive-leakage', 'rejection',
  ], [evidence(TOOL_INTEGRATION, 'never emits or persists raw text from a credential-like search query')]),
  scenario(12, 'Injetar recall apenas como dado sem autoridade', 'automatic-memory', ['oracle', 'recall'], [
    evidence(TOOL_INTEGRATION, 'recalls only safe records from the current workspace once per turn without writing'),
  ]),
  scenario(13, 'Não injetar memória irrelevante', 'automatic-memory', ['oracle', 'false-positive'], [
    evidence(TOOL_INTEGRATION, 'does not inject unrelated memory for an irrelevant PT-BR message'),
  ]),
  scenario(14, 'Manter candidato em modo sombra sem gravação durável', 'automatic-memory', ['oracle'], [
    evidence(TOOL_INTEGRATION, 'persists a safe message candidate only in the local shadow queue'),
  ]),
  scenario(15, 'Distinguir fato estável de sugestão e hipótese', 'automatic-memory', ['oracle', 'false-positive'], [
    evidence(TOOL_EXTRACTOR, 'classifies an explicit fact and ignores suggestions and hypotheses'),
  ]),
  scenario(16, 'Distinguir decisão e preferência em português brasileiro', 'automatic-memory', ['oracle'], [
    evidence(TOOL_EXTRACTOR, 'extracts an explicit PT-BR preference without retaining the command prefix'),
    evidence(TOOL_EXTRACTOR, 'extracts a confirmed project decision but ignores an ordinary question'),
  ]),
  scenario(17, 'Preservar histórico de revisões', 'correction', ['oracle'], [
    evidence(MEMORY_LOCAL, 'preserves contradictory revisions atomically and returns history only on demand'),
  ]),
  scenario(18, 'Recusar operação sem workspace registrado', 'workspace-isolation', [
    'oracle', 'workspace-leakage', 'rejection',
  ], [evidence(TOOL_INTEGRATION, 'does not extract a candidate when the session directory has no registered workspace')]),
  scenario(19, 'Omitir revisão substituída na busca ativa', 'correction', ['oracle', 'recall'], [
    evidence(MEMORY_LOCAL, 'preserves contradictory revisions atomically and returns history only on demand'),
  ]),
  scenario(20, 'Registrar mudança contraditória sem apagar a história', 'correction', ['oracle'], [
    evidence(MEMORY_LOCAL, 'preserves contradictory revisions atomically and returns history only on demand'),
  ]),
  scenario(21, 'Bloquear gravação automática sem consentimento completo', 'user-isolation', [
    'oracle', 'confirmation', 'rejection',
  ], [
    evidence(TOOL_INTEGRATION, 'keeps reviewed automatic writes disabled by default and journals the reason'),
    evidence(TOOL_INTEGRATION, 'requires both workspace and user flags before an approved candidate can be stored'),
  ]),
  scenario(22, 'Respeitar o limite rígido do contexto de recall', 'automatic-memory', ['oracle', 'recall'], [
    evidence(TOOL_INTEGRATION, 'skips an oversized memory instead of exceeding or truncating the recall budget'),
  ]),
  scenario(23, 'Não entregar prompt ou memória ao roteador externo', 'cloud-consent', [
    'oracle', 'sensitive-leakage', 'cloud-consent',
  ], [evidence(ADAPTIVE_MODEL, 'projects price only from numeric metadata and persists no prompt field')], true),
  scenario(24, 'Neutralizar prompt injection armazenado', 'prompt-injection', [
    'oracle', 'prompt-injection', 'sensitive-leakage',
  ], [evidence(TOOL_COMPOSER, 'keeps prompt-injection text inside an explicitly untrusted data envelope')], true),
  scenario(25, 'Usar Qwen local leve em conversa curta', 'routing', ['oracle'], [
    evidence(ADAPTIVE_MODEL, 'uses the fast local tier for short self-contained conversation'),
  ]),
  scenario(26, 'Elevar o esforço local para trabalho técnico médio', 'routing', ['oracle'], [
    evidence(ADAPTIVE_MODEL, 'uses the stronger local main tier for medium technical work'),
  ]),
  scenario(27, 'Recusar nuvem quando a política externa não autoriza', 'cloud-consent', [
    'oracle', 'cloud-consent', 'rejection',
  ], [evidence(ADAPTIVE_MODEL, 'fails closed when external routes are denied and no local route is capable')]),
  scenario(28, 'Recuperar paráfrase pelo índice semântico local', 'semantic-retrieval', ['oracle', 'recall'], [
    evidence(TOOL_LOADER, 'boots optional semantic retrieval and recalls a paraphrase through the real Loader seam'),
  ]),
  scenario(29, 'Impedir envio semântico de memória de outro projeto', 'workspace-isolation', [
    'oracle', 'workspace-leakage', 'sensitive-leakage',
  ], [evidence(MEMORY_LOCAL, 'never sends another workspace memory to the semantic endpoint and reindexes a corrected revision')], true),
  scenario(30, 'Retornar à busca lexical quando o Ollama semântico falhar', 'semantic-retrieval', [
    'oracle', 'recall',
  ], [evidence(MEMORY_LOCAL, 'falls back to lexical recall with sanitized telemetry when Ollama is unavailable')]),
  scenario(31, 'Manter busca semântica desativada até aprovação do benchmark', 'semantic-retrieval', ['oracle'], [
    evidence(WEB_APP, 'ships local semantic memory retrieval as an explicit opt-in'),
  ]),
]

/** Unique test files needed to execute the canonical scenario set. */
export function leonEvalTestFiles(scenarios = LEON_EVAL_SCENARIOS): string[] {
  return [...new Set(scenarios.flatMap(item => item.evidence.map(entry => entry.file)))].sort()
}

/** Validate one raw reporter file before it participates in evaluation decisions. */
export function parseLeonEvalRawRun(value: unknown): LeonEvalRawRun {
  if (!isRecord(value) || value.schemaVersion !== LEON_EVAL_SCHEMA_VERSION) {
    throw new Error('LEON-EVAL-PTBR report has an unsupported schema version')
  }
  if (value.reason !== 'passed' && value.reason !== 'failed' && value.reason !== 'interrupted') {
    throw new Error('LEON-EVAL-PTBR report has an invalid run reason')
  }
  if (!isNonNegativeNumber(value.rssBytes) || !Array.isArray(value.tests)) {
    throw new Error('LEON-EVAL-PTBR report has invalid process metrics')
  }
  const tests = value.tests.map((entry, index): LeonEvalTestResult => {
    if (!isRecord(entry)
      || typeof entry.file !== 'string'
      || typeof entry.testName !== 'string'
      || !isTestState(entry.state)
      || !isNonNegativeNumber(entry.durationMs)
      || (entry.heapBytes !== undefined && !isNonNegativeNumber(entry.heapBytes))) {
      throw new Error(`LEON-EVAL-PTBR report has an invalid test result at index ${index}`)
    }
    return {
      file: entry.file,
      testName: entry.testName,
      state: entry.state,
      durationMs: entry.durationMs,
      ...(entry.heapBytes === undefined ? {} : { heapBytes: entry.heapBytes }),
    }
  })
  return {
    schemaVersion: LEON_EVAL_SCHEMA_VERSION,
    reason: value.reason,
    rssBytes: value.rssBytes,
    tests,
  }
}

/** Aggregate repeated raw reports into one hard-fail evaluation result. */
export function aggregateLeonEvalRuns(
  runs: readonly LeonEvalRawRun[],
  scenarios: readonly LeonEvalScenario[] = LEON_EVAL_SCENARIOS,
  options: LeonEvalAggregateOptions = {},
): LeonEvalAggregateReport {
  validateScenarioRegistry(scenarios)
  const minimumRuns = options.minimumRuns ?? 3
  const targetP95Ms = options.targetP95Ms ?? 2_000
  const targetHeapP95Bytes = options.targetHeapP95Bytes ?? 512 * 1024 * 1024
  const perRun = runs.map(run => evaluateRun(run, scenarios))
  const scenarioResults = scenarios.map(item => aggregateScenario(item, perRun))
  const failedScenarios = scenarioResults.filter(item => !item.passed).map(item => item.id)
  const criticalFailures = scenarioResults.filter(item => item.critical && !item.passed).map(item => item.id)
  const missingEvidence = [...new Set(scenarioResults.flatMap(item => item.missingEvidence))].sort()
  const durations = scenarioResults.flatMap(item => item.durationMs)
  const heaps = scenarioResults.flatMap(item => item.heapBytes)
  const latencyP50 = percentile(durations, 0.50)
  const latencyP95 = percentile(durations, 0.95)
  const heapP50 = percentile(heaps, 0.50)
  const heapP95 = percentile(heaps, 0.95)
  const runMetricVectors = perRun.map(run => ({
    oracle: passRate(run, scenarios, 'oracle'),
    recall: passRate(run, scenarios, 'recall'),
  }))
  const stable = stableNumber(runMetricVectors.map(item => item.oracle))
    && stableNumber(runMetricVectors.map(item => item.recall))
  const minimumRunsMet = runs.length >= minimumRuns
  const latencyWithinTarget = latencyP95 <= targetP95Ms
  const heapWithinTarget = heaps.length === 0 || heapP95 <= targetHeapP95Bytes
  const allRunsSettled = runs.every(run => run.reason === 'passed')
  const status = minimumRunsMet
    && stable
    && allRunsSettled
    && failedScenarios.length === 0
    && latencyWithinTarget
    && heapWithinTarget
    ? 'passed'
    : 'failed'

  return {
    schemaVersion: LEON_EVAL_SCHEMA_VERSION,
    status,
    runCount: runs.length,
    scenarioCount: scenarios.length,
    minimumRunsMet,
    stable,
    failedScenarios,
    criticalFailures,
    missingEvidence,
    scenarioResults,
    metrics: {
      oraclePrecision: passRateAcrossRuns(perRun, scenarios, 'oracle'),
      recallAtK: passRateAcrossRuns(perRun, scenarios, 'recall'),
      falseDiscoveryRate: failureRateAcrossRuns(perRun, scenarios, 'oracle'),
      recallFalsePositiveRate: failureRateAcrossRuns(perRun, scenarios, 'false-positive'),
      crossWorkspaceLeakageRate: failureRateAcrossRuns(perRun, scenarios, 'workspace-leakage'),
      crossUserLeakageRate: failureRateAcrossRuns(perRun, scenarios, 'user-leakage'),
      sensitiveDataLeakageRate: failureRateAcrossRuns(perRun, scenarios, 'sensitive-leakage'),
      confirmationRate: passRateAcrossRuns(perRun, scenarios, 'confirmation'),
      rejectionRate: passRateAcrossRuns(perRun, scenarios, 'rejection'),
      cloudConsentComplianceRate: passRateAcrossRuns(perRun, scenarios, 'cloud-consent'),
      promptInjectionRejectionRate: passRateAcrossRuns(perRun, scenarios, 'prompt-injection'),
    },
    latencyMs: {
      p50: latencyP50,
      p95: latencyP95,
      targetP95: targetP95Ms,
      withinTarget: latencyWithinTarget,
    },
    heapBytes: {
      samples: heaps.length,
      p50: heapP50,
      p95: heapP95,
      targetP95: targetHeapP95Bytes,
      withinTarget: heapWithinTarget,
    },
    processRssBytes: {
      p50: percentile(runs.map(run => run.rssBytes), 0.50),
      p95: percentile(runs.map(run => run.rssBytes), 0.95),
    },
  }
}

interface EvaluatedScenario {
  readonly passed: boolean
  readonly durationMs: number
  readonly heapBytes?: number
  readonly missingEvidence: readonly string[]
}

type EvaluatedRun = ReadonlyMap<string, EvaluatedScenario>

function evaluateRun(run: LeonEvalRawRun, scenarios: readonly LeonEvalScenario[]): EvaluatedRun {
  const tests = run.tests.map(test => ({ ...test, file: normalizePath(test.file) }))
  return new Map(scenarios.map((item) => {
    const evidenceResults = item.evidence.map((entry) => {
      const file = normalizePath(entry.file)
      const matches = tests.filter(test => test.file === file && test.testName === entry.testName)
      return { entry, matches }
    })
    const missingEvidence = evidenceResults
      .filter(result => result.matches.length === 0)
      .map(result => `${result.entry.file} :: ${result.entry.testName}`)
    const matched = evidenceResults.flatMap(result => result.matches)
    const passed = run.reason === 'passed'
      && missingEvidence.length === 0
      && matched.length > 0
      && matched.every(test => test.state === 'passed')
    const heapValues = matched.flatMap(test => test.heapBytes === undefined ? [] : [test.heapBytes])
    return [item.id, {
      passed,
      durationMs: matched.reduce((total, test) => total + test.durationMs, 0),
      ...(heapValues.length === 0 ? {} : { heapBytes: Math.max(...heapValues) }),
      missingEvidence,
    }]
  }))
}

function aggregateScenario(
  scenarioDefinition: LeonEvalScenario,
  runs: readonly EvaluatedRun[],
): LeonEvalScenarioResult {
  const outcomes = runs.flatMap((run) => {
    const result = run.get(scenarioDefinition.id)
    return result === undefined ? [] : [result]
  })
  return {
    id: scenarioDefinition.id,
    titlePtBr: scenarioDefinition.titlePtBr,
    category: scenarioDefinition.category,
    critical: scenarioDefinition.critical,
    passed: outcomes.length === runs.length && outcomes.length > 0 && outcomes.every(item => item.passed),
    durationMs: outcomes.map(item => item.durationMs),
    heapBytes: outcomes.flatMap(item => item.heapBytes === undefined ? [] : [item.heapBytes]),
    missingEvidence: [...new Set(outcomes.flatMap(item => item.missingEvidence))].sort(),
  }
}

function validateScenarioRegistry(scenarios: readonly LeonEvalScenario[]): void {
  if (scenarios.length < 20) throw new Error('LEON-EVAL-PTBR requires at least 20 scenarios')
  const ids = new Set<string>()
  for (const item of scenarios) {
    if (ids.has(item.id)) throw new Error(`LEON-EVAL-PTBR repeats scenario id ${item.id}`)
    if (item.evidence.length === 0) throw new Error(`LEON-EVAL-PTBR scenario ${item.id} has no executable evidence`)
    ids.add(item.id)
  }
}

function passRateAcrossRuns(
  runs: readonly EvaluatedRun[],
  scenarios: readonly LeonEvalScenario[],
  tag: LeonEvalMetricTag,
): number {
  if (runs.length === 0) return 0
  return mean(runs.map(run => passRate(run, scenarios, tag)))
}

function failureRateAcrossRuns(
  runs: readonly EvaluatedRun[],
  scenarios: readonly LeonEvalScenario[],
  tag: LeonEvalMetricTag,
): number {
  const tagged = scenarios.filter(item => item.metrics.includes(tag))
  if (tagged.length === 0 || runs.length === 0) return 0
  const outcomes = runs.flatMap(run => tagged.map(item => run.get(item.id)?.passed === true))
  return outcomes.filter(passed => !passed).length / outcomes.length
}

function passRate(
  run: EvaluatedRun,
  scenarios: readonly LeonEvalScenario[],
  tag: LeonEvalMetricTag,
): number {
  const tagged = scenarios.filter(item => item.metrics.includes(tag))
  if (tagged.length === 0) return 0
  return tagged.filter(item => run.get(item.id)?.passed === true).length / tagged.length
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function stableNumber(values: readonly number[]): boolean {
  const first = values[0]
  return first !== undefined && values.every(value => Math.abs(value - first) < Number.EPSILON)
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return sorted[index] ?? 0
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTestState(value: unknown): value is LeonEvalTestResult['state'] {
  return value === 'passed' || value === 'failed' || value === 'skipped' || value === 'pending'
}
