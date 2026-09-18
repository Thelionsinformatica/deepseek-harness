/**
 * Authenticated, streaming Leon recovery container.
 *
 * The manifest and every payload file are encrypted independently with
 * AES-256-GCM under one scrypt-derived key. The format is deliberately not an
 * archive format: fixed-size records from the authenticated manifest remove
 * ZIP traversal, symlink, compression-bomb, and duplicate-entry semantics from
 * the restore surface.
 *
 * @module @deepseek-ai/dsh/recovery-format
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, open, opendir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, join, posix, resolve } from 'node:path'

/** One regular file carried by a recovery package. */
export interface LeonBackupFile {
  /** Portable POSIX path relative to the restored Harness home. */
  readonly path: string
  readonly size: number
  readonly sha256: string
  /** Owner permission bits only; group/other and special bits are never restored. */
  readonly mode: number
}

/** Best-effort local Ollama inventory. Model weights are never copied. */
export interface LeonLocalModelInventory {
  readonly source: 'ollama'
  readonly status: 'captured' | 'unavailable' | 'skipped-non-local'
  readonly models: readonly string[]
}

/** Versioned encrypted manifest for one recovery package. */
export interface LeonBackupManifest {
  readonly schemaVersion: 1
  readonly product: 'Leon'
  readonly snapshotId: string
  readonly createdAt: string
  readonly source: {
    readonly leonVersion: string
    readonly platform: NodeJS.Platform
    readonly arch: string
    readonly nodeVersion: string
  }
  readonly workspace: {
    readonly path: string
    readonly contentsIncluded: false
  }
  readonly localModels: LeonLocalModelInventory
  /** The managed credential store is excluded; authored/history files may still contain pasted secrets. */
  readonly credentialStoreIncluded: false
  readonly anonymousIdentityIncluded: false
  readonly exclusions: readonly string[]
  readonly files: readonly LeonBackupFile[]
}

/** Source inode paired with its authenticated manifest record. */
export interface LeonBackupSource {
  readonly absolutePath: string
  readonly canonicalPath: string
  readonly identity: LeonBackupSourceIdentity
  readonly file: LeonBackupFile
}

/** Descriptor identity captured while the source plan is hashed. */
interface LeonBackupSourceIdentity {
  readonly dev: string
  readonly ino: string
  readonly size: string
  readonly mtimeNs: string
  readonly ctimeNs: string
}

/** Optional test/coordination hooks around atomic publication. */
export interface WriteBackupHooks {
  /** Runs after the complete temp file is synced, immediately before publication. */
  readonly beforeCommit?: () => Promise<void>
  /** Test/installer observation after publication; failure becomes a warning. */
  readonly afterPublish?: () => Promise<void>
}

/** Publication details that distinguish success from post-publication warnings. */
export interface BackupPublicationResult {
  readonly published: true
  readonly temporaryCleanupConfirmed: boolean
  readonly directorySyncConfirmed: boolean
  readonly warnings: readonly string[]
}

/** Optional coordination seam used by installers and adversarial tests. */
export interface RestoreBackupHooks {
  /** Runs after the full read-only authentication pass and before staging exists. */
  readonly afterVerification?: () => Promise<void>
  /** Runs after staging is authenticated and immediately before destination claim. */
  readonly beforePublish?: () => Promise<void>
}

const MAGIC = Buffer.from('LEONBK1\n', 'ascii')
const FORMAT_VERSION = 1
const SALT_BYTES = 16
const NONCE_PREFIX_BYTES = 8
const AUTH_TAG_BYTES = 16
const HEADER_BYTES = MAGIC.byteLength + 1 + SALT_BYTES + NONCE_PREFIX_BYTES + 4
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_FILES = 200_000
const MAX_FILE_BYTES = 256 * 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024 * 1024
const STREAM_CHUNK_BYTES = 64 * 1024
const SCRYPT_OPTIONS = { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/iu
const SHA256 = /^[a-f\d]{64}$/u
const PROFILE_FILES = new Set(['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])
const ROOT_FILES = new Set(['settings.yaml', 'cordis.patch.yml', 'AGENTS.md'])
/** Exact authoritative JSON stores carried by recovery v1. */
export const LEON_BACKUP_STORAGE_FILES = [
  'workspace.json',
  'memory_local.json',
  'personal_memory_local.json',
  'memory_candidate.json',
  'memory_admin.json',
  'personal_memory_admin.json',
  'procedure_learning.json',
  'message_feedback.json',
  'failure_recovery.json',
] as const
const STORAGE_FILES = new Set<string>(LEON_BACKUP_STORAGE_FILES)
const NAMED_SECRET_FILE = /^(?:\.credentials\.ya?ml|\.env(?:\..*)?|\.npmrc|secrets?(?:\..*)?|credentials?(?:\..*)?)$/iu
const SECRET_EXTENSION = new Set(['.key', '.pem', '.p12', '.pfx'])

/** Stable descriptor identity for source-change and path-swap detection. */
function sourceIdentity(metadata: BigIntStats): LeonBackupSourceIdentity {
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  }
}

/** Whether descriptor metadata still equals the planned source generation. */
function sameSourceIdentity(metadata: BigIntStats, expected: LeonBackupSourceIdentity): boolean {
  const actual = sourceIdentity(metadata)
  return actual.dev === expected.dev && actual.ino === expected.ino && actual.size === expected.size
    && actual.mtimeNs === expected.mtimeNs && actual.ctimeNs === expected.ctimeNs
}

/** Compare canonical paths using Windows's case-insensitive spelling rules. */
function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Stable path comparison independent of the host locale. */
function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Turn a thrown value into one bounded local diagnostic. */
export function recoveryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`
}

/** Derive the container key without exposing the passphrase in argv or files. */
async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return await new Promise((resolveKey, reject) => {
    scrypt(passphrase, salt, 32, SCRYPT_OPTIONS, (error, key) => {
      if (error !== null) reject(error)
      else resolveKey(key)
    })
  })
}

/** Nonce zero encrypts the manifest; file records use one-based indices. */
function nonce(prefix: Buffer, index: number): Buffer {
  if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
    throw new Error(`leon backup: invalid record index ${index}`)
  }
  const value = Buffer.alloc(12)
  prefix.copy(value, 0)
  value.writeUInt32BE(index, NONCE_PREFIX_BYTES)
  return value
}

function manifestAad(): Buffer {
  return Buffer.from('Leon backup v1 manifest', 'utf8')
}

function fileAad(file: LeonBackupFile, index: number): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: 1, index, ...file }), 'utf8')
}

/** Write every byte even when the filesystem accepts a partial write. */
async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset, null)
    if (bytesWritten === 0) throw new Error('leon backup: filesystem made no write progress')
    offset += bytesWritten
  }
}

/** Read exactly one bounded region or fail as truncated. */
async function readExact(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const result = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(result, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error('leon backup: arquivo truncado')
    offset += bytesRead
  }
  return result
}

/** Sync a renamed entry's parent where POSIX exposes directory fsync. */
/* v8 ignore start -- Windows rejects directory handles; POSIX release gates cover this branch. */
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */

/** Validate one path for Windows portability and extraction containment. */
function validatePortablePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 2_048) {
    throw new Error('leon backup: caminho de entrada inválido')
  }
  if (path.includes('\\') || path.includes('\0') || path.includes(':') || path.startsWith('/') || posix.normalize(path) !== path) {
    throw new Error(`leon backup: caminho inseguro no manifesto: ${JSON.stringify(path)}`)
  }
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`leon backup: caminho inseguro no manifesto: ${JSON.stringify(path)}`)
  }
  for (const segment of segments) {
    if (/[\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment) || RESERVED_WINDOWS_NAMES.test(segment)) {
      throw new Error(`leon backup: nome incompatível com Windows: ${JSON.stringify(segment)}`)
    }
  }
}

/** Match the explicit filename exclusions used while collecting authored trees. */
export function excludedLeonCredentialFilename(name: string): boolean {
  return NAMED_SECRET_FILE.test(name) || SECRET_EXTENSION.has(extname(name).toLowerCase())
}

/** Restrict restore destinations to the exact state grammar the collector emits. */
function allowedStatePath(path: string): boolean {
  const segments = path.split('/')
  if (segments.length === 1) return ROOT_FILES.has(path)
  const root = segments[0] ?? ''
  const leaf = segments.at(-1) ?? ''
  if (root === 'sessions') {
    return segments.length >= 3 && /^session\.jsonl(?:\.zstd)?$/u.test(leaf)
  }
  if (root === 'attachments') {
    return segments.length >= 4 && segments[1] === 'v1' && segments[2] === 'objects'
  }
  if (root === 'storages') return segments.length === 2 && STORAGE_FILES.has(leaf)
  if (['skills', '.agent-presets', 'spills'].includes(root)) {
    return segments.length >= 2 && !excludedLeonCredentialFilename(leaf) && !leaf.endsWith('.tmp')
  }
  return root === 'profiles' && segments.length === 3 && PROFILE_FILES.has(leaf)
}

/** Validate untrusted decrypted JSON before it influences filesystem writes. */
export function validateLeonBackupManifest(value: unknown): asserts value is LeonBackupManifest {
  if (typeof value !== 'object' || value === null) throw new Error('leon backup: manifesto inválido')
  const manifest = value as Record<string, unknown>
  if (manifest.schemaVersion !== 1 || manifest.product !== 'Leon') {
    throw new Error('leon backup: versão ou produto do manifesto não suportado')
  }
  if (typeof manifest.snapshotId !== 'string' || manifest.snapshotId.length < 16
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error('leon backup: identidade ou data do manifesto inválida')
  }
  if (manifest.credentialStoreIncluded !== false || manifest.anonymousIdentityIncluded !== false) {
    throw new Error('leon backup: pacote incompatível inclui o cofre gerenciado ou a identidade anônima')
  }
  const source = manifest.source
  if (typeof source !== 'object' || source === null) throw new Error('leon backup: origem do manifesto inválida')
  const sourceRecord = source as Record<string, unknown>
  if (typeof sourceRecord.leonVersion !== 'string'
    || typeof sourceRecord.platform !== 'string'
    || typeof sourceRecord.arch !== 'string'
    || typeof sourceRecord.nodeVersion !== 'string') {
    throw new Error('leon backup: origem do manifesto inválida')
  }
  const workspace = manifest.workspace
  if (typeof workspace !== 'object' || workspace === null) throw new Error('leon backup: referência de workspace inválida')
  const workspaceRecord = workspace as Record<string, unknown>
  if (typeof workspaceRecord.path !== 'string' || workspaceRecord.contentsIncluded !== false) {
    throw new Error('leon backup: referência de workspace inválida')
  }
  const localModels = manifest.localModels
  if (typeof localModels !== 'object' || localModels === null) throw new Error('leon backup: inventário de modelos inválido')
  const modelsRecord = localModels as Record<string, unknown>
  const modelStatus = modelsRecord.status
  const modelList: readonly unknown[] = Array.isArray(modelsRecord.models) ? modelsRecord.models : []
  if (modelsRecord.source !== 'ollama'
    || typeof modelStatus !== 'string'
    || !['captured', 'unavailable', 'skipped-non-local'].includes(modelStatus)
    || !Array.isArray(modelsRecord.models)
    || modelList.some(model => typeof model !== 'string' || model.length > 512)) {
    throw new Error('leon backup: inventário de modelos inválido')
  }
  const exclusions: readonly unknown[] = Array.isArray(manifest.exclusions) ? manifest.exclusions : []
  if (!Array.isArray(manifest.exclusions) || exclusions.some(item => typeof item !== 'string')) {
    throw new Error('leon backup: lista de exclusões inválida')
  }
  const files: readonly unknown[] = Array.isArray(manifest.files) ? manifest.files : []
  if (!Array.isArray(manifest.files) || files.length > MAX_FILES) {
    throw new Error('leon backup: quantidade de arquivos inválida')
  }
  const exact = new Set<string>()
  const portable = new Set<string>()
  let total = 0
  let previous = ''
  for (const candidate of files) {
    if (typeof candidate !== 'object' || candidate === null) throw new Error('leon backup: entrada inválida')
    const entry = candidate as Record<string, unknown>
    validatePortablePath(entry.path)
    const path = entry.path
    const size = entry.size
    const sha256 = entry.sha256
    const mode = entry.mode
    if (!allowedStatePath(path)) throw new Error(`leon backup: escopo não permitido: ${path}`)
    if (!Number.isSafeInteger(size) || typeof size !== 'number' || size < 0 || size > MAX_FILE_BYTES
      || typeof sha256 !== 'string' || !SHA256.test(sha256)
      || !Number.isInteger(mode) || typeof mode !== 'number' || mode < 0 || mode > 0o700) {
      throw new Error(`leon backup: metadados inválidos para ${path}`)
    }
    if (previous !== '' && comparePath(path, previous) <= 0) {
      throw new Error('leon backup: entradas não estão em ordem canônica')
    }
    previous = path
    const folded = path.normalize('NFC').toLowerCase()
    if (exact.has(path) || portable.has(folded)) throw new Error(`leon backup: caminho duplicado ou colidente: ${path}`)
    exact.add(path)
    portable.add(folded)
    let prefix = posix.dirname(path)
    while (prefix !== '.') {
      if (exact.has(prefix) || portable.has(prefix.normalize('NFC').toLowerCase())) {
        throw new Error(`leon backup: conflito entre arquivo e pasta: ${path}`)
      }
      prefix = posix.dirname(prefix)
    }
    total += size
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL_BYTES) throw new Error('leon backup: payload excede o limite suportado')
  }
}

/** Encrypt one small complete record. */
function encryptRecord(plain: Buffer, key: Buffer, recordNonce: Buffer, aad: Buffer): { cipherText: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', key, recordNonce)
  cipher.setAAD(aad)
  const cipherText = Buffer.concat([cipher.update(plain), cipher.final()])
  return { cipherText, tag: cipher.getAuthTag() }
}

/** Decrypt and authenticate one small complete record. */
function decryptRecord(cipherText: Buffer, tag: Buffer, key: Buffer, recordNonce: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, recordNonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(cipherText), decipher.final()])
}

/** Stream exactly the planned source prefix into one authenticated record. */
async function encryptSource(output: FileHandle, source: LeonBackupSource, key: Buffer, prefix: Buffer, index: number): Promise<void> {
  const metadata = await lstat(source.absolutePath, { bigint: true })
  const canonical = await realpath(source.absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n
    || !sameSourceIdentity(metadata, source.identity) || !sameCanonicalPath(canonical, source.canonicalPath)) {
    throw new Error(`leon backup: origem mudou ou deixou de ser arquivo regular: ${source.file.path}`)
  }
  const input = await open(source.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, index))
  cipher.setAAD(fileAad(source.file, index))
  const digest = createHash('sha256')
  let remaining = source.file.size
  let bytes = 0
  try {
    const opened = await input.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || !sameSourceIdentity(opened, source.identity)) {
      throw new Error(`leon backup: descritor de origem mudou: ${source.file.path}`)
    }
    const buffer = Buffer.alloc(STREAM_CHUNK_BYTES)
    while (remaining > 0) {
      const wanted = Math.min(remaining, buffer.byteLength)
      const { bytesRead } = await input.read(buffer, 0, wanted, null)
      if (bytesRead === 0) throw new Error(`leon backup: origem foi truncada durante a leitura: ${source.file.path}`)
      const chunk = buffer.subarray(0, bytesRead)
      digest.update(chunk)
      await writeAll(output, cipher.update(chunk))
      remaining -= bytesRead
      bytes += bytesRead
    }
    await writeAll(output, cipher.final())
    await writeAll(output, cipher.getAuthTag())
    const after = await input.stat({ bigint: true })
    if (!sameSourceIdentity(after, source.identity)) {
      throw new Error(`leon backup: origem mudou durante a leitura: ${source.file.path}`)
    }
  } finally {
    await input.close()
  }
  const pathAfter = await lstat(source.absolutePath, { bigint: true })
  const canonicalAfter = await realpath(source.absolutePath)
  if (!sameSourceIdentity(pathAfter, source.identity) || !sameCanonicalPath(canonicalAfter, source.canonicalPath)) {
    throw new Error(`leon backup: caminho da origem foi trocado: ${source.file.path}`)
  }
  if (bytes !== source.file.size || digest.digest('hex') !== source.file.sha256) {
    throw new Error(`leon backup: ${source.file.path} mudou durante o snapshot; pare o Leon e tente novamente`)
  }
}

/** Refuse an existing path, including a symlink or junction. */
async function assertMissing(path: string, label: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error(`leon backup: ${label} já existe: ${path}`)
}

/**
 * Create and atomically publish one encrypted recovery package.
 *
 * The destination is never overwritten. A private same-parent staging file is
 * synced and published through an exclusive hard link; any source drift or
 * coordination failure removes only that known temp inode and empty directory.
 */
export async function writeLeonBackupArchive(
  outputPath: string,
  manifest: LeonBackupManifest,
  sources: readonly LeonBackupSource[],
  passphrase: string,
  hooks: WriteBackupHooks = {},
): Promise<BackupPublicationResult> {
  validateLeonBackupManifest(manifest)
  if (sources.length !== manifest.files.length
    || sources.some((source, index) => source.file !== manifest.files[index])) {
    throw new Error('leon backup: plano de origem não corresponde ao manifesto')
  }
  const output = resolve(outputPath)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await assertMissing(output, 'arquivo de destino')
  let tempDirectory: string | undefined
  let temp: string | undefined
  let handle: FileHandle | undefined
  const salt = randomBytes(SALT_BYTES)
  const prefix = randomBytes(NONCE_PREFIX_BYTES)
  const key = await deriveKey(passphrase, salt)
  try {
    tempDirectory = await mkdtemp(join(dirname(output), `.${basename(output)}.build-`))
    temp = join(tempDirectory, 'package.tmp')
    const manifestPlain = Buffer.from(JSON.stringify(manifest), 'utf8')
    if (manifestPlain.byteLength > MAX_MANIFEST_BYTES) throw new Error('leon backup: manifesto excede o limite suportado')
    const encrypted = encryptRecord(manifestPlain, key, nonce(prefix, 0), manifestAad())
    const header = Buffer.alloc(HEADER_BYTES)
    MAGIC.copy(header, 0)
    header.writeUInt8(FORMAT_VERSION, MAGIC.byteLength)
    salt.copy(header, MAGIC.byteLength + 1)
    prefix.copy(header, MAGIC.byteLength + 1 + SALT_BYTES)
    header.writeUInt32BE(encrypted.cipherText.byteLength, HEADER_BYTES - 4)

    handle = await open(temp, 'wx', 0o600)
    await writeAll(handle, header)
    await writeAll(handle, encrypted.cipherText)
    await writeAll(handle, encrypted.tag)
    for (const [zeroIndex, source] of sources.entries()) {
      await encryptSource(handle, source, key, prefix, zeroIndex + 1)
    }
    await handle.sync()
    await handle.close()
    handle = undefined
    await hooks.beforeCommit?.()
    try {
      await link(temp, output)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code)) {
        throw new Error('leon backup: o destino não suporta publicação segura por hard link; use NTFS, APFS ou ext4', { cause: error })
      }
      throw error
    }
    const warnings: string[] = []
    try {
      await hooks.afterPublish?.()
    } catch (error) {
      warnings.push(`verificação pós-publicação não confirmada: ${recoveryErrorMessage(error)}`)
    }
    let temporaryCleanupConfirmed = true
    try {
      await unlink(temp)
      await rmdir(tempDirectory)
    } catch (error) {
      temporaryCleanupConfirmed = false
      warnings.push(`staging temporário criptografado não removido integralmente: ${recoveryErrorMessage(error)}`)
    }
    let directorySyncConfirmed = true
    try {
      await syncDirectory(dirname(output))
    } catch (error) {
      directorySyncConfirmed = false
      warnings.push(`durabilidade do diretório não confirmada: ${recoveryErrorMessage(error)}`)
    }
    return { published: true, temporaryCleanupConfirmed, directorySyncConfirmed, warnings }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (temp !== undefined) await unlink(temp).catch(() => undefined)
    if (tempDirectory !== undefined) await rmdir(tempDirectory).catch(() => undefined)
    throw error
  } finally {
    key.fill(0)
  }
}

interface OpenArchive {
  readonly handle: FileHandle
  readonly size: number
  readonly identity: LeonBackupSourceIdentity
  readonly key: Buffer
  readonly prefix: Buffer
  readonly manifest: LeonBackupManifest
  readonly payloadOffset: number
}

/** Open, decrypt, validate, and size-check an untrusted package. */
async function openArchive(archivePath: string, passphrase: string): Promise<OpenArchive> {
  const archive = resolve(archivePath)
  const metadata = await lstat(archive, { bigint: true })
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    throw new Error('leon backup: o pacote precisa ser um arquivo regular, não um link')
  }
  const handle = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW)
  let key: Buffer | undefined
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n
      || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error('leon backup: o pacote foi trocado durante a abertura')
    }
    const archiveSize = Number(opened.size)
    if (!Number.isSafeInteger(archiveSize)) throw new Error('leon backup: pacote excede o limite de tamanho')
    const header = await readExact(handle, HEADER_BYTES, 0)
    if (!header.subarray(0, MAGIC.byteLength).equals(MAGIC)
      || header.readUInt8(MAGIC.byteLength) !== FORMAT_VERSION) {
      throw new Error('leon backup: formato não reconhecido ou versão não suportada')
    }
    const saltStart = MAGIC.byteLength + 1
    const salt = header.subarray(saltStart, saltStart + SALT_BYTES)
    const prefix = Buffer.from(header.subarray(saltStart + SALT_BYTES, saltStart + SALT_BYTES + NONCE_PREFIX_BYTES))
    const manifestLength = header.readUInt32BE(HEADER_BYTES - 4)
    if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES) throw new Error('leon backup: tamanho do manifesto inválido')
    let position = HEADER_BYTES
    const cipherText = await readExact(handle, manifestLength, position)
    position += manifestLength
    const tag = await readExact(handle, AUTH_TAG_BYTES, position)
    position += AUTH_TAG_BYTES
    key = await deriveKey(passphrase, salt)
    let manifest: unknown
    try {
      manifest = JSON.parse(decryptRecord(cipherText, tag, key, nonce(prefix, 0), manifestAad()).toString('utf8'))
    } catch {
      throw new Error('leon backup: senha incorreta ou pacote adulterado')
    }
    validateLeonBackupManifest(manifest)
    const expected = manifest.files.reduce((total, file) => total + file.size + AUTH_TAG_BYTES, position)
    if (!Number.isSafeInteger(expected) || expected !== archiveSize) {
      throw new Error('leon backup: tamanho total não corresponde ao manifesto')
    }
    return { handle, size: archiveSize, identity: sourceIdentity(opened), key, prefix, manifest, payloadOffset: position }
  } catch (error) {
    key?.fill(0)
    await handle.close()
    throw error
  }
}

/** Detect writes or inode changes to an already-open package between passes. */
async function assertArchiveUnchanged(archive: OpenArchive): Promise<void> {
  const metadata = await archive.handle.stat({ bigint: true })
  if (!metadata.isFile() || metadata.nlink !== 1n || !sameSourceIdentity(metadata, archive.identity)) {
    throw new Error('leon backup: o pacote mudou durante a verificação ou restauração')
  }
}

/** Stream-decrypt and verify every payload record, optionally into private staging. */
async function consumePayload(archive: OpenArchive, staging?: string): Promise<void> {
  let position = archive.payloadOffset
  for (const [zeroIndex, entry] of archive.manifest.files.entries()) {
    const index = zeroIndex + 1
    const decipher = createDecipheriv('aes-256-gcm', archive.key, nonce(archive.prefix, index))
    decipher.setAAD(fileAad(entry, index))
    const digest = createHash('sha256')
    let output: FileHandle | undefined
    let bytes = 0
    let remaining = entry.size
    const destination = staging === undefined ? undefined : join(staging, ...entry.path.split('/'))
    const partial = destination === undefined
      ? undefined
      : join(dirname(destination), `.${basename(destination)}.${randomBytes(8).toString('hex')}.part`)
    try {
      if (destination !== undefined && partial !== undefined) {
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        output = await open(partial, 'wx', entry.mode === 0 ? 0o600 : entry.mode)
      }
      while (remaining > 0) {
        const length = Math.min(remaining, STREAM_CHUNK_BYTES)
        const cipherChunk = await readExact(archive.handle, length, position)
        position += length
        remaining -= length
        const plain = decipher.update(cipherChunk)
        digest.update(plain)
        bytes += plain.byteLength
        if (output !== undefined) await writeAll(output, plain)
      }
      const tag = await readExact(archive.handle, AUTH_TAG_BYTES, position)
      position += AUTH_TAG_BYTES
      decipher.setAuthTag(tag)
      const final = decipher.final()
      digest.update(final)
      bytes += final.byteLength
      if (bytes !== entry.size || digest.digest('hex') !== entry.sha256) {
        throw new Error(`leon backup: hash ou tamanho incorreto em ${entry.path}`)
      }
      if (output !== undefined && destination !== undefined && partial !== undefined) {
        await writeAll(output, final)
        await output.sync()
        await output.close()
        output = undefined
        await rename(partial, destination)
        await syncDirectory(dirname(destination))
      }
    } catch (error) {
      await output?.close().catch(() => undefined)
      output = undefined
      if (partial !== undefined) await unlink(partial).catch(() => undefined)
      throw new Error(
        `leon backup: falha de autenticação ou integridade em ${entry.path}: ${recoveryErrorMessage(error)}`,
        { cause: error },
      )
    } finally {
      await output?.close().catch(() => undefined)
    }
  }
  if (position !== archive.size) throw new Error('leon backup: bytes extras após o payload')
}

interface RestoreLease {
  readonly handle: FileHandle
  readonly path: string
}

/** Serialize cooperating Leon restores and fail closed after an interrupted restore. */
async function acquireRestoreLease(parent: string, target: string, manifest: LeonBackupManifest): Promise<RestoreLease> {
  const path = join(parent, `.${basename(target)}.restore.lock`)
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'wx', 0o600)
    await writeAll(handle, Buffer.from(JSON.stringify({
      schemaVersion: 1,
      product: 'Leon',
      operation: 'restore',
      pid: process.pid,
      snapshotId: manifest.snapshotId,
      createdAt: new Date().toISOString(),
      target,
    }), 'utf8'))
    await handle.sync()
    return { handle, path }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (handle !== undefined) await unlink(path).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`leon backup: outra restauração está ativa ou foi interrompida; examine o lock: ${path}`)
    }
    throw error
  }
}

/** Release only the exact cooperative lock created by this restore process. */
async function releaseRestoreLease(lease: RestoreLease): Promise<void> {
  await lease.handle.close()
  await unlink(lease.path)
}

/** Decrypt and verify a package without creating recovery files. */
export async function inspectLeonBackupArchive(archivePath: string, passphrase: string): Promise<LeonBackupManifest> {
  const archive = await openArchive(archivePath, passphrase)
  try {
    await consumePayload(archive)
    return archive.manifest
  } finally {
    archive.key.fill(0)
    await archive.handle.close()
  }
}

/** Publish staged top-level entries into a directory claimed with mkdir. */
async function publishStaging(staging: string, target: string): Promise<void> {
  // mkdir is the no-replace primitive available on every supported filesystem.
  // A final rename(staging, target) is not safe: on POSIX it can replace an
  // empty directory created by a competing process between two checks.
  try {
    await mkdir(target, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`leon backup: destino da restauração já existe: ${target}`, { cause: error })
    }
    throw error
  }
  const directory = await opendir(staging)
  const entries: string[] = []
  try {
    for await (const entry of directory) entries.push(entry.name)
  } finally {
    await directory.close()
  }
  entries.sort(comparePath)
  for (const name of entries) {
    await rename(join(staging, name), join(target, name))
  }
  await syncDirectory(target)
  await rmdir(staging)
}

/**
 * Restore a verified package into a destination that must not exist.
 *
 * Extraction happens in a private sibling staging directory. The destination
 * is claimed with an exclusive mkdir immediately before publication; v1 never
 * merges with or replaces an existing Leon home, including one created by a
 * concurrent process after the initial existence check.
 */
export async function restoreLeonBackupArchive(
  archivePath: string,
  targetPath: string,
  passphrase: string,
  expectedLeonVersion?: string,
  hooks: RestoreBackupHooks = {},
): Promise<LeonBackupManifest> {
  const target = resolve(targetPath)
  const parent = dirname(target)
  await assertMissing(target, 'destino da restauração')
  const archive = await openArchive(archivePath, passphrase)
  let staging: string | undefined
  let lease: RestoreLease | undefined
  try {
    if (expectedLeonVersion !== undefined && archive.manifest.source.leonVersion !== expectedLeonVersion) {
      throw new Error(
        `leon backup: o pacote exige Leon ${archive.manifest.source.leonVersion}; esta instalação é ${expectedLeonVersion}`,
      )
    }
    // Authenticate every byte before any plaintext staging path exists. The
    // second pass reads the same already-open inode, so path replacement
    // cannot swap in a different package between preview and publication.
    await consumePayload(archive)
    await assertArchiveUnchanged(archive)
    await hooks.afterVerification?.()
    await mkdir(parent, { recursive: true, mode: 0o700 })
    lease = await acquireRestoreLease(parent, target, archive.manifest)
    staging = await mkdtemp(join(parent, `.${basename(target)}.restore-`))
    await consumePayload(archive, staging)
    await assertArchiveUnchanged(archive)
    await hooks.beforePublish?.()
    await publishStaging(staging, target)
    staging = undefined
    await syncDirectory(parent)
    return archive.manifest
  } catch (error) {
    if (staging !== undefined) {
      throw new Error(
        `${recoveryErrorMessage(error)}; staging incompleto e não confiável preservado para diagnóstico: ${staging}`,
        { cause: error },
      )
    }
    throw error
  } finally {
    archive.key.fill(0)
    try {
      await archive.handle.close()
    } finally {
      if (lease !== undefined) await releaseRestoreLease(lease)
    }
  }
}
