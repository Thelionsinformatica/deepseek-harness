/**
 * Offline Leon state backup and restore commands.
 *
 * @module @deepseek-ai/dsh/recovery
 */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { resolveDefaultWorkspace, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  excludedLeonCredentialFilename,
  inspectLeonBackupArchive,
  LEON_BACKUP_STORAGE_FILES,
  recoveryErrorMessage,
  restoreLeonBackupArchive,
  writeLeonBackupArchive,
} from './recovery-format.ts'
import type {
  LeonBackupFile,
  LeonBackupManifest,
  LeonBackupSource,
  LeonLocalModelInventory,
} from './recovery-format.ts'

/** Parsed `dsh backup` options. */
export interface BackupCommandOptions {
  readonly output?: string
  readonly dryRun: boolean
  readonly json: boolean
  readonly confirmStopped: boolean
  readonly passphraseStdin: boolean
}

/** Parsed `dsh restore` options. */
export interface RestoreCommandOptions {
  readonly archive: string
  readonly target?: string
  readonly apply: boolean
  readonly json: boolean
  readonly confirmStopped: boolean
  readonly passphraseStdin: boolean
}

/** Backup result safe to print locally. */
export interface BackupReport {
  readonly schemaVersion: 1
  readonly product: 'Leon'
  readonly status: 'planned' | 'created'
  readonly output: string
  readonly sourceHome: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly credentialStoreIncluded: false
  readonly workspaceContentsIncluded: false
  readonly localModels: LeonLocalModelInventory
  readonly warnings: readonly string[]
}

/** Restore verification or publication result. */
export interface RestoreReport {
  readonly schemaVersion: 1
  readonly product: 'Leon'
  readonly status: 'verified' | 'restored'
  readonly archive: string
  readonly target: string
  readonly snapshotId: string
  readonly createdAt: string
  readonly sourceVersion: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly credentialStoreIncluded: false
}

interface RecoveryRuntime {
  readonly appVersion: string
  readonly home: string
  readonly workspace: string
  readonly activeLeon: () => Promise<'active' | 'inactive' | 'unknown'>
  readonly localModels: () => Promise<LeonLocalModelInventory>
  readonly readPassphrase: (confirmation: boolean, fromStdin: boolean) => Promise<string>
}

interface PlannedSource {
  readonly absolutePath: string
  readonly logicalPath: string
}

const PROFILE_FILES = ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'] as const
const ROOT_FILES = ['settings.yaml', 'cordis.patch.yml', 'AGENTS.md'] as const
const EXCLUSIONS = [
  'cofre gerenciado e arquivos nomeados de credencial, ambiente ou chave',
  'identificador anônimo de telemetria',
  'caches, temporários e profiles/node_modules',
  'índice derivado session_projcache',
  'imagens derivadas de requisição de anexos',
  'conteúdo dos workspaces e repositórios',
  'pesos Ollama/GGUF e executáveis reinstaláveis',
] as const
const MIN_PASSPHRASE_CODEPOINTS = 16

/** Stable path comparison independent of the host locale. */
function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Whether `candidate` resolves lexically below `parent`. */
function isInside(candidate: string, parent: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Exclude known credential files even from user-authored skill trees. */
function secretFilename(name: string): boolean {
  return excludedLeonCredentialFilename(name)
}

/** Reject a link, junction, hardlink, device, or unstable-size source. */
/** Identity fields that must survive planning and encryption unchanged. */
function sourceIdentity(metadata: BigIntStats): LeonBackupSource['identity'] {
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

/** Hash one source through a verified descriptor, not a trusted path lookup. */
async function fileRecord(source: PlannedSource, canonicalHome: string): Promise<LeonBackupSource> {
  const metadata = await lstat(source.absolutePath, { bigint: true })
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    throw new Error(`leon backup: fonte não é um arquivo regular exclusivo: ${source.logicalPath}`)
  }
  const input = await open(source.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  const digest = createHash('sha256')
  let remaining = Number(metadata.size)
  let bytes = 0
  let canonicalPath = ''
  try {
    const opened = await input.stat({ bigint: true })
    canonicalPath = await realpath(source.absolutePath)
    if (!opened.isFile() || opened.nlink !== 1n || !sameIdentity(opened, metadata)
      || !isInside(canonicalPath, canonicalHome)) {
      throw new Error(`leon backup: descritor fora do estado permitido: ${source.logicalPath}`)
    }
    if (!Number.isSafeInteger(remaining)) throw new Error(`leon backup: arquivo grande demais: ${source.logicalPath}`)
    const buffer = Buffer.alloc(64 * 1024)
    while (remaining > 0) {
      const wanted = Math.min(buffer.byteLength, remaining)
      const { bytesRead } = await input.read(buffer, 0, wanted, null)
      if (bytesRead === 0) throw new Error(`leon backup: arquivo truncado durante o planejamento: ${source.logicalPath}`)
      digest.update(buffer.subarray(0, bytesRead))
      remaining -= bytesRead
      bytes += bytesRead
    }
    const after = await input.stat({ bigint: true })
    if (!sameIdentity(after, opened)) throw new Error(`leon backup: arquivo mudou durante o planejamento: ${source.logicalPath}`)
  } finally {
    await input.close()
  }
  const after = await lstat(source.absolutePath, { bigint: true })
  const canonicalAfter = await realpath(source.absolutePath)
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || !sameIdentity(after, metadata)
    || canonicalAfter !== canonicalPath || !isInside(canonicalAfter, canonicalHome) || bytes !== Number(metadata.size)) {
    throw new Error(`leon backup: arquivo mudou durante o planejamento: ${source.logicalPath}`)
  }
  const file: LeonBackupFile = {
    path: source.logicalPath,
    size: Number(metadata.size),
    sha256: digest.digest('hex'),
    mode: Number(metadata.mode & 0o700n) || 0o600,
  }
  return {
    absolutePath: source.absolutePath,
    canonicalPath,
    identity: sourceIdentity(metadata),
    file,
  }
}

/** Add one optional regular file without following its final path. */
async function addOptionalFile(plan: PlannedSource[], absolutePath: string, logicalPath: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`leon backup: caminho permitido não é arquivo regular: ${logicalPath}`)
  }
  plan.push({ absolutePath, logicalPath })
}

/** Recursively enumerate one owned tree without following any link or junction. */
async function walkOwnedTree(
  plan: PlannedSource[],
  absoluteRoot: string,
  logicalRoot: string,
  accept: (path: string) => boolean,
): Promise<void> {
  let rootMetadata
  try {
    rootMetadata = await lstat(absoluteRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`leon backup: árvore permitida não é pasta real: ${logicalRoot}`)
  }
  const directory = await opendir(absoluteRoot)
  const entries = []
  for await (const entry of directory) entries.push(entry.name)
  entries.sort(comparePath)
  for (const name of entries) {
    const absolutePath = join(absoluteRoot, name)
    const logicalPath = `${logicalRoot}/${name}`
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) throw new Error(`leon backup: link ou junction recusado: ${logicalPath}`)
    if (metadata.isDirectory()) {
      await walkOwnedTree(plan, absolutePath, logicalPath, accept)
      continue
    }
    if (!metadata.isFile()) throw new Error(`leon backup: tipo de arquivo não suportado: ${logicalPath}`)
    if (secretFilename(name) || name.endsWith('.tmp') || !accept(logicalPath)) continue
    plan.push({ absolutePath, logicalPath })
  }
}

/** Enumerate only authoritative Leon state. */
async function sourcePaths(home: string): Promise<PlannedSource[]> {
  const metadata = await lstat(home)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('leon backup: DSH_HOME precisa ser uma pasta real')
  }
  const plan: PlannedSource[] = []
  for (const name of ROOT_FILES) await addOptionalFile(plan, join(home, name), name)
  await walkOwnedTree(plan, join(home, 'sessions'), 'sessions', path => /\/session\.jsonl(?:\.zstd)?$/u.test(path))
  await walkOwnedTree(plan, join(home, 'attachments', 'v1', 'objects'), 'attachments/v1/objects', () => true)
  for (const name of LEON_BACKUP_STORAGE_FILES) await addOptionalFile(plan, join(home, 'storages', name), `storages/${name}`)
  for (const name of ['skills', '.agent-presets', 'spills'] as const) {
    await walkOwnedTree(plan, join(home, name), name, () => true)
  }

  const profilesRoot = join(home, 'profiles')
  try {
    const profilesMetadata = await lstat(profilesRoot)
    if (!profilesMetadata.isDirectory() || profilesMetadata.isSymbolicLink()) {
      throw new Error('leon backup: profiles precisa ser uma pasta real')
    }
    const directory = await opendir(profilesRoot)
    const profiles = []
    for await (const entry of directory) {
      if (entry.name !== 'node_modules' && entry.name !== '.pnpm') profiles.push(entry.name)
    }
    profiles.sort(comparePath)
    for (const profile of profiles) {
      const profileRoot = join(profilesRoot, profile)
      const profileMetadata = await lstat(profileRoot)
      if (!profileMetadata.isDirectory() || profileMetadata.isSymbolicLink()) {
        throw new Error(`leon backup: perfil não é pasta real: ${profile}`)
      }
      for (const name of PROFILE_FILES) {
        await addOptionalFile(plan, join(profileRoot, name), `profiles/${profile}/${name}`)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  plan.sort((left, right) => comparePath(left.logicalPath, right.logicalPath))
  return plan
}

/** Hash the complete bounded allowlist. */
async function planSources(home: string): Promise<LeonBackupSource[]> {
  const [paths, canonicalHome] = await Promise.all([sourcePaths(home), realpath(home)])
  return await Promise.all(paths.map(path => fileRecord(path, canonicalHome)))
}

/** Confirm no file appeared or disappeared while the encrypted temp was built. */
async function assertSourceListUnchanged(home: string, original: readonly LeonBackupSource[]): Promise<void> {
  const next = await sourcePaths(home)
  const before = original.map(source => source.file.path)
  const after = next.map(source => source.logicalPath)
  if (before.length !== after.length || before.some((path, index) => path !== after[index])) {
    throw new Error('leon backup: o conjunto de arquivos mudou; pare o Leon e tente novamente')
  }
}

/** Parse a local-only Ollama URL. */
function localOllamaUrl(value: string | undefined): URL | undefined {
  const selected = value?.trim() || 'http://127.0.0.1:11434'
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(selected) ? selected : `http://${selected}`)
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) return undefined
    parsed.pathname = '/api/tags'
    parsed.search = ''
    parsed.hash = ''
    return parsed
  } catch {
    return undefined
  }
}

/** Inventory local model names without sending prompts or crossing the network boundary. */
async function inspectLocalModels(): Promise<LeonLocalModelInventory> {
  const url = localOllamaUrl(process.env.OLLAMA_HOST)
  if (url === undefined) return { source: 'ollama', status: 'skipped-non-local', models: [] }
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return { source: 'ollama', status: 'unavailable', models: [] }
    const payload = await response.json() as { models?: unknown }
    const models = Array.isArray(payload.models)
      ? payload.models.flatMap((entry): string[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const name = (entry as { name?: unknown }).name
        return typeof name === 'string' ? [name] : []
      }).sort(comparePath)
      : []
    return { source: 'ollama', status: 'captured', models }
  } catch {
    return { source: 'ollama', status: 'unavailable', models: [] }
  }
}

/** Conservative loopback check: any listener on Leon's default port blocks an offline operation. */
async function defaultLeonPortState(): Promise<'active' | 'inactive' | 'unknown'> {
  try {
    await fetch('http://127.0.0.1:3080/', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(750),
    })
    return 'active'
  } catch (error) {
    const code = (error as { cause?: { code?: unknown } }).cause?.code
    return code === 'ECONNREFUSED' ? 'inactive' : 'unknown'
  }
}

/** Read one bounded line from a non-TTY pipe. */
async function readPassphraseFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('leon backup: --passphrase-stdin exige entrada redirecionada, não digitação visível')
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      if (line.length > 4_096) throw new Error('leon backup: senha excede o limite')
      return line
    }
  } finally {
    lines.close()
  }
  throw new Error('leon backup: nenhuma senha recebida pela entrada padrão')
}

/** Read one line from a real TTY without echoing its bytes. */
async function readHiddenLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('leon backup: use um terminal interativo ou --passphrase-stdin')
  }
  process.stdout.write(prompt)
  const input = process.stdin
  input.setEncoding('utf8')
  input.setRawMode(true)
  input.resume()
  return await new Promise((resolveLine, reject) => {
    let value = ''
    const cleanup = (): void => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
    }
    const onData = (chunk: string | Buffer): void => {
      const text = String(chunk)
      for (const character of text) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('leon backup: operação cancelada'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolveLine(value)
          return
        }
        if (character === '\b' || character === '\u007f') value = Array.from(value).slice(0, -1).join('')
        else value += character
        if (Array.from(value).length > 4_096) {
          cleanup()
          reject(new Error('leon backup: senha excede o limite'))
          return
        }
      }
    }
    input.on('data', onData)
  })
}

/** Obtain and validate a passphrase without argv or environment variables. */
async function promptPassphrase(confirmation: boolean, fromStdin: boolean): Promise<string> {
  const first = fromStdin ? await readPassphraseFromStdin() : await readHiddenLine('Senha do pacote: ')
  if (Array.from(first).length < MIN_PASSPHRASE_CODEPOINTS) {
    throw new Error(`leon backup: a senha precisa ter pelo menos ${MIN_PASSPHRASE_CODEPOINTS} caracteres`)
  }
  if (confirmation && !fromStdin) {
    const second = await readHiddenLine('Confirme a senha: ')
    if (first !== second) throw new Error('leon backup: as senhas não coincidem')
  }
  return first
}

/** Runtime defaults for the installed launcher. */
function realRuntime(appVersion: string): RecoveryRuntime {
  return {
    appVersion,
    home: resolveDshHome(),
    workspace: resolveDefaultWorkspace(),
    activeLeon: defaultLeonPortState,
    localModels: inspectLocalModels,
    readPassphrase: promptPassphrase,
  }
}

/** Safe default package path under Leon's standard workspace. */
export function defaultLeonBackupPath(workspace: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/gu, '-').replace('Z', 'Z')
  return join(resolve(workspace), 'Backups', 'Leon', `leon-${stamp}.leon-backup`)
}

/** Ensure the package cannot recursively capture itself through DSH_HOME. */
async function validateOutputPath(output: string, home: string): Promise<void> {
  if (isInside(output, home)) throw new Error('leon backup: o arquivo de backup não pode ficar dentro de DSH_HOME')
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const [canonicalParent, canonicalHome] = await Promise.all([realpath(dirname(output)), realpath(home)])
  if (isInside(canonicalParent, canonicalHome)) {
    throw new Error('leon backup: o destino resolve para dentro de DSH_HOME')
  }
}

/** Build the encrypted manifest from one already-hashed source plan. */
async function manifestFor(runtime: RecoveryRuntime, sources: readonly LeonBackupSource[]): Promise<LeonBackupManifest> {
  return {
    schemaVersion: 1,
    product: 'Leon',
    snapshotId: randomUUID(),
    createdAt: new Date().toISOString(),
    source: {
      leonVersion: runtime.appVersion,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
    },
    workspace: { path: runtime.workspace, contentsIncluded: false },
    localModels: await runtime.localModels(),
    credentialStoreIncluded: false,
    anonymousIdentityIncluded: false,
    exclusions: EXCLUSIONS,
    files: sources.map(source => source.file),
  }
}

/** Convert one manifest into a printable restore report. */
function restoreReport(status: RestoreReport['status'], archive: string, target: string, manifest: LeonBackupManifest): RestoreReport {
  return {
    schemaVersion: 1,
    product: 'Leon',
    status,
    archive,
    target,
    snapshotId: manifest.snapshotId,
    createdAt: manifest.createdAt,
    sourceVersion: manifest.source.leonVersion,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    credentialStoreIncluded: false,
  }
}

/** Human PT-BR backup summary. */
function formatBackupReport(report: BackupReport): string {
  const action = report.status === 'created' ? 'criado e verificado' : 'planejado; nenhum arquivo foi criado'
  const lines = [
    `Backup do Leon ${action}.`,
    `Arquivo: ${report.output}`,
    `Estado: ${report.fileCount} arquivo(s), ${report.totalBytes} byte(s).`,
    'Cofre de credenciais: não incluído; deverá ser cadastrado novamente após a restauração.',
    'Atenção: histórico e arquivos autorais podem conter segredos colados; mantenha o pacote criptografado.',
    'Workspace e modelos: somente referências/inventário; conteúdos e pesos não foram copiados.',
  ]
  if (report.warnings.length > 0) lines.push(...report.warnings.map(warning => `Aviso: ${warning}`))
  lines.push('')
  return lines.join('\n')
}

/** Human PT-BR restore summary. */
function formatRestoreReport(report: RestoreReport): string {
  const action = report.status === 'restored'
    ? `restaurado em ${report.target}`
    : 'validado integralmente; nenhuma pasta foi alterada'
  return [
    `Pacote do Leon ${action}.`,
    `Snapshot: ${report.snapshotId} (${report.createdAt})`,
    `Origem: Leon ${report.sourceVersion}; ${report.fileCount} arquivo(s), ${report.totalBytes} byte(s).`,
    'O cofre de credenciais não faz parte do pacote e precisa ser cadastrado novamente.',
    'Histórico e arquivos autorais restaurados podem conter segredos que o usuário inseriu.',
    '',
  ].join('\n')
}

/** Enforce the explicit offline safety contract and the observable default port. */
async function requireOffline(runtime: RecoveryRuntime, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error('leon backup: encerre completamente o Leon e confirme com --confirm-stopped')
  const state = await runtime.activeLeon()
  if (state === 'active') throw new Error('leon backup: há um serviço ativo na porta 3080; encerre o Leon antes de continuar')
  if (state === 'unknown') throw new Error('leon backup: não foi possível comprovar que a porta 3080 está inativa')
}

/** Create or dry-plan one encrypted state package. */
export async function createLeonBackup(
  options: BackupCommandOptions,
  appVersion: string,
  runtime: RecoveryRuntime = realRuntime(appVersion),
): Promise<BackupReport> {
  const output = resolve(options.output ?? defaultLeonBackupPath(runtime.workspace))
  if (!options.dryRun) await requireOffline(runtime, options.confirmStopped)
  const sources = await planSources(runtime.home)
  const manifest = await manifestFor(runtime, sources)
  const report: BackupReport = {
    schemaVersion: 1,
    product: 'Leon',
    status: options.dryRun ? 'planned' : 'created',
    output,
    sourceHome: runtime.home,
    fileCount: sources.length,
    totalBytes: sources.reduce((total, source) => total + source.file.size, 0),
    credentialStoreIncluded: false,
    workspaceContentsIncluded: false,
    localModels: manifest.localModels,
    warnings: [],
  }
  if (options.dryRun) return report
  await validateOutputPath(output, runtime.home)
  const passphrase = await runtime.readPassphrase(true, options.passphraseStdin)
  const publication = await writeLeonBackupArchive(output, manifest, sources, passphrase, {
    beforeCommit: async () => { await assertSourceListUnchanged(runtime.home, sources) },
  })
  let verified: LeonBackupManifest
  try {
    verified = await inspectLeonBackupArchive(output, passphrase)
    if (verified.snapshotId !== manifest.snapshotId) throw new Error('snapshot publicado não corresponde ao planejado')
  } catch (error) {
    throw new Error(
      `leon backup: o pacote foi publicado em ${output}, mas falhou na verificação posterior; preserve-o para diagnóstico e não o use: ${recoveryErrorMessage(error)}`,
      { cause: error },
    )
  }
  return { ...report, warnings: publication.warnings }
}

/** Verify or restore one package without ever replacing an existing home. */
export async function processLeonRestore(
  options: RestoreCommandOptions,
  appVersion: string,
  runtime: RecoveryRuntime = realRuntime(appVersion),
): Promise<RestoreReport> {
  const archive = resolve(options.archive)
  const target = resolve(options.target ?? runtime.home)
  if (options.apply) await requireOffline(runtime, options.confirmStopped)
  const passphrase = await runtime.readPassphrase(false, options.passphraseStdin)
  if (!options.apply) {
    const preview = await inspectLeonBackupArchive(archive, passphrase)
    return restoreReport('verified', archive, target, preview)
  }
  const restored = await restoreLeonBackupArchive(archive, target, passphrase, appVersion)
  return restoreReport('restored', archive, target, restored)
}

/** Run `dsh backup` with sanitized output and exit status. */
export async function runBackup(
  options: BackupCommandOptions,
  appVersion: string,
  write: (text: string) => void = (text) => { process.stdout.write(text) },
  writeError: (text: string) => void = (text) => { process.stderr.write(text) },
): Promise<number> {
  try {
    const report = await createLeonBackup(options, appVersion)
    write(options.json ? `${JSON.stringify(report, undefined, 2)}\n` : formatBackupReport(report))
    return 0
  } catch (error) {
    const message = recoveryErrorMessage(error)
    writeError(options.json ? `${JSON.stringify({ product: 'Leon', status: 'failed', error: message })}\n` : `Falha no backup do Leon: ${message}\n`)
    return 1
  }
}

/** Run `dsh restore` with sanitized output and exit status. */
export async function runRestore(
  options: RestoreCommandOptions,
  appVersion: string,
  write: (text: string) => void = (text) => { process.stdout.write(text) },
  writeError: (text: string) => void = (text) => { process.stderr.write(text) },
): Promise<number> {
  try {
    const report = await processLeonRestore(options, appVersion)
    write(options.json ? `${JSON.stringify(report, undefined, 2)}\n` : formatRestoreReport(report))
    return 0
  } catch (error) {
    const message = recoveryErrorMessage(error)
    writeError(options.json ? `${JSON.stringify({ product: 'Leon', status: 'failed', error: message })}\n` : `Falha na restauração do Leon: ${message}\n`)
    return 1
  }
}
