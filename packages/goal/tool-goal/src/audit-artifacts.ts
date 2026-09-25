/** Exact, bounded artifact reads and provider-aware freshness checks for completion reviews. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'

/** Deployment bounds on reviewed paths and each complete UTF-8 file. */
export interface AuditArtifactLimits {
  readonly maxFiles: number
  readonly maxBytes: number
}

/** Content-free binding to the exact bytes returned by one successful artifact read. */
export interface AuditArtifactFile {
  readonly requestedPath: string
  readonly targetKey: string
  readonly sha256: string
  readonly bytes: number
}

/** Persisted coverage concerns files actually delivered, not completeness of the auditor's selection. */
export interface AuditArtifactManifest {
  readonly version: 1
  readonly coverage: 'files-reviewed' | 'no-files-reviewed'
  readonly workspace?: { readonly cwd: string; readonly targetKey: string }
  readonly files: readonly AuditArtifactFile[]
}

interface Snapshot {
  readonly workspace: { readonly cwd: string; readonly targetKey: string }
  readonly file: AuditArtifactFile
  readonly content: string
}

function unavailable(): HarnessError {
  return new HarnessError('artifact evidence is unavailable, outside the workspace, sensitive, or exceeds its bounds',
    'GOAL_QUALITY_AUDIT_ARTIFACT_UNAVAILABLE')
}

function stale(): HarnessError {
  return new HarnessError('a reviewed artifact or workspace changed; a fresh review is required',
    'GOAL_QUALITY_AUDIT_ARTIFACT_STALE')
}

function validateLimits(limits: AuditArtifactLimits): void {
  if (!Number.isSafeInteger(limits.maxFiles) || limits.maxFiles < 1
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
    throw new TypeError('artifact maxFiles and maxBytes must be positive safe integers')
  }
}

/** Reject credential locations and stream syntax; arbitrary secrets in ordinary files require separate policy. */
function sensitivePath(path: string): boolean {
  // Only the leading drive designator may contain a colon, including extended Windows paths.
  const withoutDrive = path.replace(/^(?:[\\/]{2}[?.][\\/])?[a-z]:/iu, '')
  if (withoutDrive.includes(':')) return true
  return withoutDrive.split(/[\\/]/u).some((part) => {
    const basename = part.replace(/[ .]+$/u, '')
    return /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|credentials(?:\..*)?|secrets?(?:\..*)?)$/iu.test(basename)
      || /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/iu.test(basename)
  })
}

async function snapshot(fs: FileSystem, cwd: string, requestedPath: string,
  limits: AuditArtifactLimits, signal: AbortSignal): Promise<Snapshot> {
  signal.throwIfAborted()
  if (cwd.trim().length === 0 || requestedPath.trim().length === 0 || sensitivePath(requestedPath)) throw unavailable()
  const workspace = await fs.resolve(cwd, { signal })
  const target = await fs.resolve(requestedPath, { cwd, signal })
  if (!fs.contains(workspace, target) || sensitivePath(target.displayPath)) throw unavailable()
  const before = await fs.stat(target, signal)
  if (before?.type !== 'file' || (before.size !== undefined && before.size > limits.maxBytes)) throw unavailable()
  const bytes = await fs.readBytes(target, signal, limits.maxBytes)
  if (bytes.byteLength > limits.maxBytes) throw unavailable()
  const after = await fs.stat(target, signal)
  const currentTarget = await fs.resolve(requestedPath, { cwd, signal })
  const currentWorkspace = await fs.resolve(cwd, { signal })
  signal.throwIfAborted()
  if (before.version !== after?.version || after.type !== 'file'
    || currentTarget.targetKey !== target.targetKey || currentWorkspace.targetKey !== workspace.targetKey
    || !fs.contains(currentWorkspace, currentTarget)) throw stale()
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  // Reject binary-looking text instead of presenting incomplete or decoded substitute evidence.
  if (content.includes('\0')) throw unavailable()
  return { workspace: { cwd, targetKey: workspace.targetKey }, content,
    file: { requestedPath, targetKey: target.targetKey,
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength } }
}

function sameFile(left: AuditArtifactFile, right: AuditArtifactFile): boolean {
  return left.requestedPath === right.requestedPath && left.targetKey === right.targetKey
    && left.sha256 === right.sha256 && left.bytes === right.bytes
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unavailable()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw unavailable()
}

function nonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate untrusted durable evidence without permitting invented fields or ambiguous empty coverage.
 * @param value - parsed receipt artifact manifest, never inferred from model text.
 * @returns nothing; a valid manifest narrows `value` in place.
 * @throws when version, keys, coverage, identities, digests, or byte counts are invalid.
 */
export function validateAuditArtifactManifest(value: unknown): asserts value is AuditArtifactManifest {
  const manifest = objectRecord(value)
  const files = manifest['files']
  if (manifest['version'] !== 1 || !Array.isArray(files)) throw unavailable()
  const populated = files.length > 0
  exactKeys(manifest, populated ? ['version', 'coverage', 'workspace', 'files'] : ['version', 'coverage', 'files'])
  if (manifest['coverage'] !== (populated ? 'files-reviewed' : 'no-files-reviewed')) throw unavailable()
  if (populated) {
    const workspace = objectRecord(manifest['workspace'])
    exactKeys(workspace, ['cwd', 'targetKey'])
    if (!nonemptyText(workspace['cwd']) || !nonemptyText(workspace['targetKey'])) throw unavailable()
  }
  const seen = new Set<string>()
  for (const candidate of files) {
    const file = objectRecord(candidate)
    exactKeys(file, ['requestedPath', 'targetKey', 'sha256', 'bytes'])
    const path = file['requestedPath']
    if (!nonemptyText(path) || seen.has(path) || !nonemptyText(file['targetKey'])
      || typeof file['sha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(file['sha256'])
      || typeof file['bytes'] !== 'number' || !Number.isSafeInteger(file['bytes']) || file['bytes'] < 0) throw unavailable()
    seen.add(path)
  }
}

/** Captures only complete, successful model-visible reads by one host-assigned auditor. */
export class AuditArtifacts {
  private readonly files = new Map<string, AuditArtifactFile>()
  private readonly pending = new Map<ToolExecutionToken, { snapshot: Snapshot; rendered: string }>()
  private workspace: AuditArtifactManifest['workspace']
  private bound = false
  private failed = false

  constructor(private readonly limits: AuditArtifactLimits) { validateLimits(limits) }

  /**
   * Install the reader before the child's first request; the scope owns teardown.
   * @param ctx - unpublished child context providing the same execution-world filesystem.
   * @param agent - exact host-created auditor, never a model-provided identity.
   */
  install(ctx: Context, agent: Agent): void {
    if (this.bound) throw new Error('artifact reader is already assigned')
    this.bound = true
    const cwd = agent.session.header.cwd
    const fs = ctx.get('fs')
    ctx.on('tools/result', (exec, result) => {
      const candidate = this.pending.get(exec.token)
      if (candidate === undefined) return
      this.pending.delete(exec.token)
      if (result.isError) return
      if (exec.agent !== agent || result.content.length !== 1
        || result.content[0]?.type !== 'text' || result.content[0].text !== candidate.rendered) {
        this.failed = true
        return
      }
      if (!this.files.has(candidate.snapshot.file.requestedPath) && this.files.size >= this.limits.maxFiles) {
        this.failed = true
        return
      }
      this.workspace = candidate.snapshot.workspace
      this.files.set(candidate.snapshot.file.requestedPath, candidate.snapshot.file)
    })
    ctx.effect(() => () => { this.pending.clear() })
    ctx.tools.register(defineTool({
      name: 'completion_artifact_read',
      description: 'Read one complete UTF-8 artifact inside your assigned workspace. '
        + 'The host binds successful reads to exact bytes and rechecks them before completion. '
        + 'Cannot read conventional credential files. A read proves access, not correctness or complete requirement coverage.',
      parameters: { file_path: { type: 'string', required: true, description: 'Workspace-relative or absolute artifact path.' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (exec.agent !== agent || ctx.agents.currentInitiator() !== agent || fs === undefined || cwd === undefined) {
          throw unavailable()
        }
        if (!this.files.has(args.file_path) && this.files.size >= this.limits.maxFiles) throw unavailable()
        let captured: Snapshot
        try { captured = await snapshot(fs, cwd, args.file_path, this.limits, exec.signal) } catch (error: unknown) {
          if (exec.signal.aborted) throw error
          if (error instanceof HarnessError && error.code === 'GOAL_QUALITY_AUDIT_ARTIFACT_STALE') throw error
          throw unavailable()
        }
        const previous = this.files.get(args.file_path)
        if ((previous !== undefined && !sameFile(previous, captured.file))
          || (this.workspace !== undefined && this.workspace.targetKey !== captured.workspace.targetKey)) {
          this.failed = true
          throw stale()
        }
        const rendered = JSON.stringify({ path: args.file_path, sha256: captured.file.sha256,
          bytes: captured.file.bytes, content: captured.content })
        this.pending.set(exec.token, { snapshot: captured, rendered })
        return rendered
      },
      presentCall: args => ({ card: 'generic', kind: 'read', title: 'Read review artifact', rawInput: args.file_path }),
    }))
  }

  /**
   * Snapshot successful deliveries; empty coverage must never be described as file verification.
   * @returns detached content-free evidence, or a failure when delivery was altered.
   */
  manifest(): AuditArtifactManifest {
    if (this.failed || this.pending.size > 0) throw unavailable()
    return { version: 1, coverage: this.files.size === 0 ? 'no-files-reviewed' : 'files-reviewed',
      ...this.workspace === undefined ? {} : { workspace: { ...this.workspace } },
      files: [...this.files.values()].map(file => ({ ...file })) }
  }
}

/**
 * Recheck a durable manifest through the current filesystem provider without trusting display paths as identities.
 * @param ctx - execution context with the same provider world as the review.
 * @param manifest - content-free manifest loaded from the audit receipt.
 * @param limits - current deployment bounds, also enforced on durable input.
 * @param signal - caller cancellation forwarded to every provider operation.
 * @returns fulfillment when all recorded bytes and identities still match; empty coverage remains empty.
 */
export async function verifyAuditArtifacts(ctx: Context, manifest: AuditArtifactManifest,
  limits: AuditArtifactLimits, signal: AbortSignal): Promise<void> {
  validateLimits(limits)
  signal.throwIfAborted()
  validateAuditArtifactManifest(manifest)
  if (manifest.files.length > limits.maxFiles) throw unavailable()
  if (manifest.files.length === 0) return
  const fs = ctx.get('fs')
  const workspace = manifest.workspace
  if (fs === undefined || workspace === undefined || typeof workspace.cwd !== 'string'
    || typeof workspace.targetKey !== 'string') throw unavailable()
  for (const file of manifest.files) {
    if (file.bytes > limits.maxBytes) throw unavailable()
    let current: Snapshot
    try { current = await snapshot(fs, workspace.cwd, file.requestedPath, limits, signal) } catch (error: unknown) {
      if (signal.aborted) throw error
      throw stale()
    }
    if (current.workspace.targetKey !== workspace.targetKey || !sameFile(current.file, file)) throw stale()
  }
}
