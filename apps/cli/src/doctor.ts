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
  http(url: string): Promise<HttpProbe>
  command(command: string, args: readonly string[]): string | undefined
}

const HTTP_PREFIX_LIMIT = 64 * 1024
const REQUIRED_LOCAL_MODELS = ['qwen3.5:9b', 'ornith-1.5:9b'] as const

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

/** Inspect the local Ollama endpoint and the two automatic-routing models. */
async function ollamaCheck(environment: DoctorEnvironment): Promise<DoctorCheck> {
  if (environment.ollamaBaseUrl.startsWith('invalid:')) {
    return { id: 'ollama', label: 'Ollama', status: 'failed', summary: environment.ollamaBaseUrl.slice('invalid:'.length) }
  }
  try {
    const response = await environment.http(`${environment.ollamaBaseUrl}/api/tags`)
    if (response.status < 200 || response.status >= 300) {
      return { id: 'ollama', label: 'Ollama', status: 'warning', summary: `respondeu HTTP ${response.status}` }
    }
    const payload = JSON.parse(response.body) as { models?: unknown }
    const names = Array.isArray(payload.models)
      ? payload.models.flatMap((entry): string[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const name = (entry as { name?: unknown }).name
        return typeof name === 'string' ? [name] : []
      })
      : []
    const missing = REQUIRED_LOCAL_MODELS.filter(required => !names.includes(required))
    if (missing.length > 0) {
      return {
        id: 'ollama',
        label: 'Ollama',
        status: 'warning',
        summary: `${names.length} modelo(s) encontrado(s); roteamento automático local incompleto`,
        details: missing.map(name => `modelo necessário ausente: ${name}`),
      }
    }
    return { id: 'ollama', label: 'Ollama', status: 'ok', summary: `${names.length} modelo(s); Qwen e Ornith disponíveis` }
  } catch (error) {
    return { id: 'ollama', label: 'Ollama', status: 'warning', summary: `indisponível em ${environment.ollamaBaseUrl}`, details: [errorMessage(error)] }
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
  return version === undefined
    ? { id: 'powershell', label: 'PowerShell', status: 'failed', summary: 'PowerShell 7 (pwsh) não foi encontrado' }
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
  const [homeProbe, workspaceProbe, buildProbe, profile, ollama, web] = await Promise.all([
    environment.path(environment.home),
    environment.path(environment.workspace),
    environment.path(join(environment.packageRoot, 'lib', 'bin.js')),
    profileCheck(environment, options.profile),
    ollamaCheck(environment),
    webCheck(environment, options.port),
  ])
  const home = directoryCheck('home', 'Dados do Leon', environment.home, homeProbe, 'warning')
  const workspace = directoryCheck('workspace', 'Pasta de trabalho', environment.workspace, workspaceProbe, 'failed')
  const build: DoctorCheck = buildProbe.kind === 'file'
    ? { id: 'build', label: 'Aplicativo compilado', status: 'ok', summary: `versão ${environment.packageVersion}` }
    : { id: 'build', label: 'Aplicativo compilado', status: 'warning', summary: 'lib/bin.js ausente; execução a partir do código-fonte ainda pode funcionar' }
  const checks = [node, powershellCheck(environment), home, workspace, profile, build, ollama, web]
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
