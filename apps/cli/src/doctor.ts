/**
 * Read-only Leon runtime diagnosis for installation, support, and recovery.
 *
 * @module @deepseek-ai/dsh/doctor
 */

import { spawnSync } from 'node:child_process'
import { constants, readFileSync } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { resolveDefaultWorkspace, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Severity of one independent diagnostic check. */
type DoctorCheckStatus = 'ok' | 'warning' | 'failed'

/** One sanitized diagnostic result. */
interface DoctorCheck {
  /** Stable machine-readable check id. */
  readonly id: string
  /** Human-facing PT-BR label. */
  readonly label: string
  /** Check outcome. */
  readonly status: DoctorCheckStatus
  /** Concise result without credentials or file contents. */
  readonly summary: string
  /** Optional bounded supporting facts. */
  readonly details?: readonly string[]
}

/** Complete versioned diagnosis document. */
export interface DoctorReport {
  /** Report format version. */
  readonly schemaVersion: 1
  readonly product: 'Leon'
  readonly version: string
  readonly checkedAt: string
  readonly overall: DoctorCheckStatus
  readonly checks: readonly DoctorCheck[]
}

/** Parsed command options used by {@link runDoctor}. */
export interface DoctorOptions {
  readonly profile: string
  readonly port: number
  readonly json: boolean
}

interface PathProbe {
  readonly kind: 'directory' | 'file' | 'missing' | 'error'
  readonly readable: boolean
  readonly writable: boolean
  readonly error?: string
}

interface HttpProbe {
  readonly status: number
  readonly body: string
}

interface DoctorEnvironment {
  readonly platform: NodeJS.Platform
  readonly nodeVersion: string
  readonly packageRoot: string
  readonly packageVersion: string
  readonly home: string
  readonly workspace: string
  readonly ollamaBaseUrl: string
  readonly checkedAt: string
  path(path: string): Promise<PathProbe>
  settings(path: string): unknown
  http(url: string): Promise<HttpProbe>
  command(command: string, args: readonly string[]): string | undefined
}

const HTTP_PREFIX_LIMIT = 64 * 1024
const SETTINGS_LIMIT = 1024 * 1024

interface LocalSelection {
  readonly provider: 'llamacpp' | 'ollama'
  readonly model: string
  readonly baseUrl: string
}

/** Treat durable YAML mappings as untrusted, without inspecting credential values. */
function mapping(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read the same default settings document as settings-file, without initializing it. */
function readSettings(path: string): unknown {
  const source = readFileSync(path, 'utf8')
  if (Buffer.byteLength(source) > SETTINGS_LIMIT) throw new Error('settings document exceeds diagnostic limit')
  return loadYaml(source, { schema: JSON_SCHEMA })
}

/** Limit metadata probes to explicit local providers; a loopback gateway is not a local model. */
function localBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/u, '')
  } catch {
    // URL parser errors can contain the original URL, including credentials.
    return undefined
  }
}

interface ModelIdentity {
  readonly provider: string
  readonly model: string
}

function selectedModel(document: unknown): ModelIdentity | undefined {
  const settings = mapping(document)
  const selection = mapping(settings?.['agent-default-model'])
  const provider = selection?.provider
  const model = selection?.model
  return typeof provider === 'string' && provider.trim() !== '' && typeof model === 'string' && model.trim() !== ''
    ? { provider: provider.trim(), model: model.trim() }
    : undefined
}

function displayIdentifier(value: string): string {
  return value.replace(/[^\w./:-]/gu, '?').slice(0, 160)
}

/** Resolve only saved local selections, never infer a provider from its display name or port. */
function selectedLocalModel(document: unknown, environment: DoctorEnvironment): LocalSelection | undefined {
  const selected = selectedModel(document)
  if (selected === undefined || (selected.provider !== 'llamacpp' && selected.provider !== 'ollama')) return undefined
  const settings = mapping(document)
  const configured = mapping(mapping(mapping(settings?.['llm-pi-ai'])?.providers)?.[selected.provider])
  const base = configured?.baseURL
  const baseUrl = typeof base === 'string' ? base : selected.provider === 'ollama' ? environment.ollamaBaseUrl : ''
  return { ...selected, provider: selected.provider, baseUrl }
}

/** Convert an arbitrary thrown value into a bounded diagnostic. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 240 ? message : `${message.slice(0, 237)}...`
}

/** Probe one path without creating or modifying it. */
async function probePath(path: string): Promise<PathProbe> {
  try {
    const metadata = await stat(path)
    let readable = true
    let writable = true
    try {
      await access(path, constants.R_OK)
    } catch {
      readable = false
    }
    try {
      await access(path, constants.W_OK)
    } catch {
      writable = false
    }
    return {
      kind: metadata.isDirectory() ? 'directory' : 'file',
      readable,
      writable,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', readable: false, writable: false }
    }
    return { kind: 'error', readable: false, writable: false, error: errorMessage(error) }
  }
}

/** Read at most the prefix needed for service identification. */
async function responsePrefix(response: Response): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (bytes < HTTP_PREFIX_LIMIT) {
      const next = await reader.read()
      if (next.done) break
      const remaining = HTTP_PREFIX_LIMIT - bytes
      const chunk = next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining)
      chunks.push(chunk)
      bytes += chunk.byteLength
      if (chunk.byteLength < next.value.byteLength) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

/** Perform one bounded read-only HTTP request. */
async function probeHttp(url: string): Promise<HttpProbe> {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(2_000),
  })
  return { status: response.status, body: await responsePrefix(response) }
}

/** Run a bounded local version probe without inheriting an interactive window. */
function probeCommand(command: string, args: readonly string[]): string | undefined {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
  })
  if (result.status !== 0 || result.error !== undefined) return undefined
  const output = `${result.stdout}${result.stderr}`.trim()
  return output === '' ? undefined : output.slice(0, 160)
}

/** Normalize Ollama's configured host without transmitting prompts or credentials. */
function ollamaBaseUrl(value: string | undefined): string {
  const selected = value?.trim() || 'http://127.0.0.1:11434'
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(selected) ? selected : `http://${selected}`
  const parsed = new URL(withProtocol)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`OLLAMA_HOST usa protocolo não suportado: ${parsed.protocol}`)
  }
  parsed.username = ''
  parsed.password = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/u, '')
}

/** Read the installed package version without relying on a repository checkout. */
function packageVersion(packageRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Build real, read-only probes for one invocation. */
function realEnvironment(): DoctorEnvironment {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let ollama: string
  try {
    ollama = ollamaBaseUrl(process.env.OLLAMA_HOST)
  } catch (error) {
    ollama = `invalid:${errorMessage(error)}`
  }
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    packageRoot,
    packageVersion: packageVersion(packageRoot),
    home: resolveDshHome(),
    workspace: resolveDefaultWorkspace(),
    ollamaBaseUrl: ollama,
    checkedAt: new Date().toISOString(),
    path: probePath,
    settings: readSettings,
    http: probeHttp,
    command: probeCommand,
  }
}

/** Whether the runtime satisfies the repository's Node engine range. */
function supportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return (major === 22 && minor >= 19) || major >= 24
}

/** Convert a path probe into one required-directory check. */
function directoryCheck(id: string, label: string, path: string, probe: PathProbe, missing: DoctorCheckStatus): DoctorCheck {
  if (probe.kind === 'missing') return { id, label, status: missing, summary: `não encontrado: ${path}` }
  if (probe.kind === 'error') return { id, label, status: 'failed', summary: probe.error ?? `não foi possível acessar ${path}` }
  if (probe.kind !== 'directory') return { id, label, status: 'failed', summary: `o caminho não é uma pasta: ${path}` }
  if (!probe.readable || !probe.writable) {
    const missingAccess = [!probe.readable ? 'leitura' : '', !probe.writable ? 'gravação' : ''].filter(Boolean).join(' e ')
    return { id, label, status: 'failed', summary: `sem acesso de ${missingAccess}: ${path}` }
  }
  return { id, label, status: 'ok', summary: path }
}

/** Inspect the installed profile without booting or initializing it. */
async function profileCheck(environment: DoctorEnvironment, profile: string): Promise<DoctorCheck> {
  const root = join(environment.home, 'profiles', profile)
  const rootProbe = await environment.path(root)
  if (rootProbe.kind === 'missing') {
    return { id: 'profile', label: 'Perfil', status: 'warning', summary: `${profile} ainda não foi inicializado` }
  }
  if (rootProbe.kind !== 'directory') {
    return { id: 'profile', label: 'Perfil', status: 'failed', summary: `${root} não é uma pasta de perfil válida` }
  }
  const [manifest, patch] = await Promise.all([
    environment.path(join(root, 'package.json')),
    environment.path(join(root, 'cordis.patch.yml')),
  ])
  const missing = [manifest.kind !== 'file' ? 'package.json' : '', patch.kind !== 'file' ? 'cordis.patch.yml' : ''].filter(Boolean)
  if (missing.length > 0) {
    return { id: 'profile', label: 'Perfil', status: 'failed', summary: `${profile} está incompleto`, details: missing.map(name => `arquivo ausente: ${name}`) }
  }
  return { id: 'profile', label: 'Perfil', status: 'ok', summary: `${profile} instalado` }
}

/** Probe metadata without sending credentials, loading models, or asserting inference success. */
async function modelChecks(environment: DoctorEnvironment): Promise<DoctorCheck[]> {
  let document: unknown
  try {
    document = environment.settings(join(environment.home, 'settings.yaml'))
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return [{ id: 'model-selection', label: 'Modelo configurado', status: missing ? 'warning' : 'failed',
      summary: missing ? 'settings.yaml ausente; seleção efetiva não verificada' : 'settings.yaml não pôde ser lido; conteúdo omitido por segurança' }]
  }
  const identity = selectedModel(document)
  if (identity === undefined) return [{ id: 'model-selection', label: 'Modelo configurado', status: 'warning',
    summary: 'seleção ausente em settings.yaml; nenhum provedor externo foi consultado' }]
  const selected = selectedLocalModel(document, environment)
  if (selected === undefined) return [{ id: 'model-selection', label: 'Modelo configurado', status: 'ok',
    summary: `modelo externo configurado: ${displayIdentifier(identity.provider)}/${displayIdentifier(identity.model)}; disponibilidade não consultada` }]
  const baseUrl = localBaseUrl(selected.baseUrl)
  if (baseUrl === undefined) return [{ id: 'model-selection', label: 'Modelo configurado', status: 'failed',
    summary: 'endereço local ausente, inválido ou não loopback; nenhum provedor foi consultado' }]

  const label = selected.provider === 'llamacpp' ? 'llama.cpp' : 'Ollama'
  const nativeRoot = baseUrl.replace(/\/v1$/u, '')
  const checks: DoctorCheck[] = [{ id: 'model-selection', label: 'Modelo configurado', status: 'ok',
    summary: `${label}: ${selected.model}`, details: ['fonte: agent-default-model e llm-pi-ai.providers em settings.yaml'] }]
  const healthUrl = selected.provider === 'llamacpp' ? new URL('/health', baseUrl).href : `${nativeRoot}/api/version`
  checks.push(await metadataCheck(environment, 'model-health', `Serviço ${label}`, healthUrl, (payload) => {
    const ready = selected.provider === 'llamacpp' ? payload.status === 'ok' : typeof payload.version === 'string'
    return ready ? 'serviço respondeu com saúde válida; não comprova inferência' : undefined
  }))
  const catalogUrl = selected.provider === 'llamacpp' ? `${baseUrl}/models` : `${nativeRoot}/api/tags`
  checks.push(await metadataCheck(environment, 'model-catalog', `Catálogo ${label}`, catalogUrl, (payload) => {
    const entries = selected.provider === 'llamacpp' ? payload.data : payload.models
    if (!Array.isArray(entries)) return undefined
    const names = new Set(entries.flatMap((entry): string[] => {
      const value = mapping(entry)?.[selected.provider === 'llamacpp' ? 'id' : 'name']
      return typeof value === 'string' ? [value] : []
    }))
    return names.has(selected.model) ? `${names.size} modelo(s); modelo selecionado presente no catálogo` : undefined
  }, `modelo selecionado ausente ou catálogo inválido: ${selected.model}`))
  checks.push({ id: 'model-inference', label: 'Inferência', status: 'warning',
    summary: 'não executada; saúde e catálogo não validam geração, ferramentas ou desempenho da GPU' })
  return checks
}

/** Report wire failures without echoing server payloads or parser diagnostics. */
async function metadataCheck(
  environment: DoctorEnvironment, id: string, label: string, url: string,
  summarize: (payload: Record<string, unknown>) => string | undefined,
  unavailable = 'resposta de saúde inválida; prontidão não confirmada',
): Promise<DoctorCheck> {
  try {
    const response = await environment.http(url)
    if (response.status < 200 || response.status >= 300) return { id, label, status: 'warning', summary: `respondeu HTTP ${response.status}; prontidão não confirmada` }
    const payload = mapping(JSON.parse(response.body))
    const summary = payload === undefined ? undefined : summarize(payload)
    return summary === undefined ? { id, label, status: 'warning', summary: unavailable } : { id, label, status: 'ok', summary }
  } catch {
    // Network and parser exceptions may echo an untrusted response or URL.
    return { id, label, status: 'warning', summary: 'serviço indisponível ou resposta inválida; prontidão não confirmada' }
  }
}

/** Distinguish a stopped Leon Web process from an unrelated port occupant. */
async function webCheck(environment: DoctorEnvironment, port: number): Promise<DoctorCheck> {
  const url = `http://127.0.0.1:${port}/`
  try {
    const response = await environment.http(url)
    const leon = /<title[^>]*>[^<]*\bLeon\b/iu.test(response.body) || /The Lions Inform[aá]tica/iu.test(response.body)
    if (response.status >= 200 && response.status < 400 && leon) {
      return { id: 'web', label: 'Leon Web', status: 'ok', summary: `ativo em ${url}` }
    }
    return {
      id: 'web',
      label: 'Leon Web',
      status: 'failed',
      summary: `a porta ${port} respondeu, mas não foi identificada como Leon`,
      details: [`HTTP ${response.status}`],
    }
  } catch (error) {
    return { id: 'web', label: 'Leon Web', status: 'warning', summary: `não está ativo em ${url}`, details: [errorMessage(error)] }
  }
}

/** Diagnose PowerShell only where the Windows tool stack requires it. */
function powershellCheck(environment: DoctorEnvironment): DoctorCheck {
  if (environment.platform !== 'win32') {
    return { id: 'powershell', label: 'PowerShell', status: 'ok', summary: 'não é requisito nesta plataforma' }
  }
  const version = environment.command('pwsh', ['--version'])
    ?? environment.command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'])
  return version === undefined
    ? { id: 'powershell', label: 'PowerShell', status: 'failed', summary: 'PowerShell não foi encontrado' }
    : { id: 'powershell', label: 'PowerShell', status: 'ok', summary: version }
}

/** Highest severity present in a list of checks. */
function overallStatus(checks: readonly DoctorCheck[]): DoctorCheckStatus {
  if (checks.some(check => check.status === 'failed')) return 'failed'
  if (checks.some(check => check.status === 'warning')) return 'warning'
  return 'ok'
}

/**
 * Collect one diagnosis without mutating files, services, credentials, or network configuration.
 * @param options - selected profile, expected Web port, and output mode.
 * @param environment - injectable read-only probes for tests.
 * @returns the sanitized diagnosis report.
 */
export async function collectDoctorReport(
  options: DoctorOptions,
  environment: DoctorEnvironment = realEnvironment(),
): Promise<DoctorReport> {
  const node: DoctorCheck = supportedNode(environment.nodeVersion)
    ? { id: 'node', label: 'Node.js', status: 'ok', summary: environment.nodeVersion }
    : { id: 'node', label: 'Node.js', status: 'failed', summary: `${environment.nodeVersion} não atende ^22.19 ou >=24` }
  const [homeProbe, workspaceProbe, buildProbe, profile, models, web] = await Promise.all([
    environment.path(environment.home),
    environment.path(environment.workspace),
    environment.path(join(environment.packageRoot, 'lib', 'bin.js')),
    profileCheck(environment, options.profile),
    modelChecks(environment),
    webCheck(environment, options.port),
  ])
  const home = directoryCheck('home', 'Dados do Leon', environment.home, homeProbe, 'warning')
  const workspace = directoryCheck('workspace', 'Pasta de trabalho', environment.workspace, workspaceProbe, 'failed')
  const build: DoctorCheck = buildProbe.kind === 'file'
    ? { id: 'build', label: 'Aplicativo compilado', status: 'ok', summary: `versão ${environment.packageVersion}` }
    : { id: 'build', label: 'Aplicativo compilado', status: 'warning', summary: 'lib/bin.js ausente; execução a partir do código-fonte ainda pode funcionar' }
  const checks = [node, powershellCheck(environment), home, workspace, profile, build, ...models, web]
  return {
    schemaVersion: 1,
    product: 'Leon',
    version: environment.packageVersion,
    checkedAt: environment.checkedAt,
    overall: overallStatus(checks),
    checks,
  }
}

const STATUS_LABEL: Readonly<Record<DoctorCheckStatus, string>> = {
  ok: 'OK',
  warning: 'AVISO',
  failed: 'FALHA',
}

/**
 * Render a concise PT-BR report for the local terminal.
 * @param report - sanitized diagnosis document.
 * @returns text ending in one newline.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`Leon Doctor ${report.version}`, '']
  for (const check of report.checks) {
    lines.push(`[${STATUS_LABEL[check.status]}] ${check.label}: ${check.summary}`)
    for (const detail of check.details ?? []) lines.push(`  - ${detail}`)
  }
  const counts = report.checks.reduce<Record<DoctorCheckStatus, number>>(
    (current, check) => ({ ...current, [check.status]: current[check.status] + 1 }),
    { ok: 0, warning: 0, failed: 0 },
  )
  lines.push('', `Resumo: ${counts.ok} OK, ${counts.warning} aviso(s), ${counts.failed} falha(s).`)
  return `${lines.join('\n')}\n`
}

/**
 * Run the doctor command and return its process exit status.
 * @param options - parsed command options.
 * @param write - output sink; defaults to stdout.
 * @returns zero when no check failed, otherwise one.
 */
export async function runDoctor(
  options: DoctorOptions,
  write: (text: string) => void = (text) => { process.stdout.write(text) },
): Promise<number> {
  const report = await collectDoctorReport(options)
  write(options.json ? `${JSON.stringify(report, undefined, 2)}\n` : formatDoctorReport(report))
  return report.overall === 'failed' ? 1 : 0
}
