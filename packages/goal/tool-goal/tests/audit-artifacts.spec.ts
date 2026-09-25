import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { FileSystem, FsTargetKey, FsVersion, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { AuditArtifacts, validateAuditArtifactManifest, verifyAuditArtifacts,
  type AuditArtifactLimits } from '../src/audit-artifacts.ts'

const contexts: Context[] = []
const limits = { maxFiles: 3, maxBytes: 1024 }
const signal = new AbortController().signal

afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

/** Remote-like provider: target keys deliberately are not operating-system paths. */
class MemoryFs extends FileSystem {
  readonly paths = new Map<string, string>([['/workspace', 'opaque-root'], ['/workspace/report.md', 'opaque-file']])
  readonly files = new Map<string, { bytes: Uint8Array; revision: number }>([
    ['opaque-file', { bytes: new TextEncoder().encode('A ação vale 300.'), revision: 1 }],
  ])
  afterRead: (() => void) | undefined
  resolve(path: string, options?: { cwd?: string }): Promise<FsTarget> {
    const full = path.startsWith('/') ? path : `${options?.cwd ?? '/workspace'}/${path}`
    return Promise.resolve({ targetKey: FsTargetKey(this.paths.get(full) ?? `missing:${full}`), displayPath: full })
  }
  contains(parent: FsTarget, child: FsTarget): boolean {
    return parent.targetKey === 'opaque-root' && child.displayPath.startsWith('/workspace/')
  }
  stat(target: FsTarget): Promise<FsInfo | undefined> {
    const value = this.files.get(target.targetKey)
    return Promise.resolve(value === undefined ? undefined
      : { type: 'file', size: value.bytes.length, version: FsVersion(String(value.revision)) })
  }
  readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const value = this.files.get(target.targetKey)
    if (value === undefined || value.bytes.length > maxBytes) return Promise.reject(new Error('read refused'))
    const result = value.bytes.slice()
    this.afterRead?.()
    return Promise.resolve(result)
  }
  processPath(): never { throw new Error('host path access forbidden in this test') }
  fileUrl(): never { throw new Error('host URI access forbidden in this test') }
  lstat(): never { throw new Error('unused') }
  readText(): never { throw new Error('unused') }
  streamText(): never { throw new Error('unused') }
  listDir(): never { throw new Error('unused') }
  writeText(): never { throw new Error('auditor mutation forbidden') }
  editText(): never { throw new Error('auditor mutation forbidden') }
}

async function fixture(bounds: AuditArtifactLimits = limits) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryFs)
  const id = SessionId(`artifact-test-${Math.random()}`)
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: '/workspace' })
  const agent: Agent = {
    id: session.id, session, options: {}, ctx, status: 'running',
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    send() {}, followup() {}, inject() {}, cancel() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    whenIdle: () => Promise.resolve(), runMaintenance: task => task(signal),
  }
  ctx.agents.register(agent)
  const artifacts = new AuditArtifacts(bounds)
  artifacts.install(ctx, agent)
  let calls = 0
  const read = (path = 'report.md') => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    agent, signal, name: 'completion_artifact_read', callId: CallId(`read-${++calls}`), arguments: { file_path: path },
  }))
  return { ctx, agent, artifacts, read, fs: ctx.fs as MemoryFs }
}

describe('completion artifact evidence', () => {
  it('binds complete delivered bytes to opaque provider identities and revalidates a detached receipt', async () => {
    const { ctx, artifacts, read } = await fixture()
    expect((await read()).isError).toBe(false)
    const manifest = artifacts.manifest()
    expect(manifest.coverage).toBe('files-reviewed')
    expect(manifest.files).toEqual([expect.objectContaining({ requestedPath: 'report.md', targetKey: 'opaque-file', bytes: 18 })])
    expect(JSON.stringify(manifest)).not.toContain('A ação')
    const restored: unknown = JSON.parse(JSON.stringify(manifest))
    validateAuditArtifactManifest(restored)
    await expect(verifyAuditArtifacts(ctx, restored, limits, signal)).resolves.toBeUndefined()
    expect((await read()).isError).toBe(false)
    expect(artifacts.manifest().files).toHaveLength(1)
  })

  it('keeps empty coverage explicitly different from reviewed files', async () => {
    const { ctx, artifacts } = await fixture()
    const manifest = artifacts.manifest()
    expect(manifest).toEqual({ version: 1, coverage: 'no-files-reviewed', files: [] })
    await expect(verifyAuditArtifacts(ctx, manifest, limits, signal)).resolves.toBeUndefined()
  })

  it.each(['changed', 'deleted', 'redirected', 'workspace-redirected'])('refuses a %s artifact after review', async (kind) => {
    const { ctx, artifacts, read, fs } = await fixture()
    await read()
    const manifest = artifacts.manifest()
    if (kind === 'changed') fs.files.set('opaque-file', { bytes: new TextEncoder().encode('WRONG'), revision: 2 })
    if (kind === 'deleted') fs.files.delete('opaque-file')
    if (kind === 'redirected') fs.paths.set('/workspace/report.md', 'different-file')
    if (kind === 'workspace-redirected') fs.paths.set('/workspace', 'different-root')
    await expect(verifyAuditArtifacts(ctx, manifest, limits, signal)).rejects.toMatchObject({ code: 'GOAL_QUALITY_AUDIT_ARTIFACT_STALE' })
  })

  it('refuses a race during a read instead of binding bytes to a later revision', async () => {
    const { artifacts, read, fs } = await fixture()
    fs.afterRead = () => { fs.files.get('opaque-file')!.revision++ }
    expect((await read()).isError).toBe(true)
    expect(artifacts.manifest().coverage).toBe('no-files-reviewed')
  })

  it.each(['.env', '.env.local', '.env::$DATA', '.env ', '.env.', '.ssh/id_ed25519',
    'credentials.json', 'secret.pem', 'secret.pem:stream', '/outside/file'])(
    'refuses sensitive or outside path %s before content access', async (path) => {
      const { artifacts, read, fs } = await fixture()
      let reads = 0
      fs.afterRead = () => { reads++ }
      expect((await read(path)).isError).toBe(true)
      expect(reads).toBe(0)
      expect(artifacts.manifest().files).toEqual([])
    },
  )

  it.each(['oversized', 'invalid-utf8', 'binary'])('does not attest %s content', async (kind) => {
    const { read, artifacts, fs } = await fixture()
    fs.files.set('opaque-file', { bytes: kind === 'oversized' ? new Uint8Array(1025)
      : kind === 'invalid-utf8' ? new Uint8Array([0xff]) : new Uint8Array([0]), revision: 1 })
    expect((await read()).isError).toBe(true)
    expect(artifacts.manifest().coverage).toBe('no-files-reviewed')
  })

  it.each(['notas.txt:secret.env', 'notas.txt:id_rsa', 'notas.txt:stream', 'notas.txt::$DATA',
    'folder:stream/notas.txt', 'C:\\workspace\\notas.txt:stream', '\\\\server\\share\\notas.txt:stream',
    '\\\\?\\C:\\workspace\\notas.txt:stream', '\\\\?\\UNC\\server\\share\\notas.txt:stream'])(
    'refuses stream syntax %s even when the provider can read it', async (path) => {
      const { artifacts, read, fs } = await fixture()
      fs.paths.set(`/workspace/${path}`, 'opaque-file')
      const readBytes = vi.spyOn(fs, 'readBytes')
      expect((await read(path)).isError).toBe(true)
      expect(readBytes).not.toHaveBeenCalled()
      expect(artifacts.manifest().files).toEqual([])
    },
  )

  it.each(['C:\\workspace\\report.md', 'C:/workspace/report.md', 'C:report.md',
    '\\\\server\\share\\report.md', '\\\\?\\C:\\workspace\\report.md', '\\\\?\\UNC\\server\\share\\report.md'])(
    'accepts an ordinary Windows path %s when the provider confines it', async (path) => {
      const { artifacts, read, fs } = await fixture()
      const resolve = fs.resolve.bind(fs)
      vi.spyOn(fs, 'resolve').mockImplementation((requested, options) => requested === path
        ? Promise.resolve({ targetKey: FsTargetKey('opaque-file'), displayPath: path })
        : resolve(requested, options))
      vi.spyOn(fs, 'contains').mockReturnValue(true)
      expect((await read(path)).isError).toBe(false)
      expect(artifacts.manifest().files).toHaveLength(1)
    },
  )

  it('enforces the file count while allowing repeated reads of the same path', async () => {
    const { artifacts, read, fs } = await fixture({ maxFiles: 1, maxBytes: 1024 })
    fs.paths.set('/workspace/second.md', 'opaque-file')
    expect((await read()).isError).toBe(false)
    expect((await read()).isError).toBe(false)
    expect((await read('second.md')).isError).toBe(true)
    expect(artifacts.manifest().files).toHaveLength(1)
  })

  it('does not retain a tool body read rejected by the final result policy', async () => {
    const { ctx, artifacts, read } = await fixture()
    ctx.on('tools/post-execute', () => Promise.resolve({ kind: 'block', feedback: [{ type: 'text', text: 'not delivered' }] }))
    expect((await read()).isError).toBe(true)
    expect(artifacts.manifest().files).toEqual([])
  })

  it('refuses a receipt after a result projection was truncated or replaced', async () => {
    const { ctx, artifacts, read } = await fixture()
    ctx.on('tools/post-execute', () => Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'TRUNCATED' }] }))
    expect((await read()).isError).toBe(false)
    expect(() => artifacts.manifest()).toThrow('artifact evidence')
  })

  it('enforces the exact auditor and initiator identities', async () => {
    const { ctx, agent, artifacts } = await fixture()
    const result = await ctx.tools.execute({ agent, signal, name: 'completion_artifact_read',
      callId: CallId('unowned'), arguments: { file_path: 'report.md' } })
    expect(result.isError).toBe(true)
    expect(artifacts.manifest().files).toEqual([])
  })

  it('checks persisted manifest count, coverage and hashes before trusting them', async () => {
    const { ctx, artifacts, read } = await fixture()
    await read()
    const manifest = artifacts.manifest()
    await expect(verifyAuditArtifacts(ctx, { ...manifest, coverage: 'no-files-reviewed' }, limits, signal)).rejects.toThrow()
    const duplicated = { ...manifest, files: [manifest.files[0]!, manifest.files[0]!] }
    await expect(verifyAuditArtifacts(ctx, duplicated, limits, signal)).rejects.toThrow()
    await expect(verifyAuditArtifacts(ctx, { ...manifest, files: [{ ...manifest.files[0]!, sha256: 'forged' }] }, limits, signal)).rejects.toThrow()
    const aborted = new AbortController()
    aborted.abort()
    await expect(verifyAuditArtifacts(ctx, manifest, limits, aborted.signal)).rejects.toThrow()
  })

  it('rejects malformed durable records and extra fields, including inside files and workspace', async () => {
    const { artifacts, read } = await fixture()
    await read()
    const manifest = artifacts.manifest()
    const mutations: unknown[] = [null, [], {}, { ...manifest, version: 2 },
      { ...manifest, approved: true }, { ...manifest, coverage: 'all-files-verified' },
      { ...manifest, files: null }, { ...manifest, files: [null] }, { ...manifest, workspace: undefined },
      { ...manifest, workspace: { ...manifest.workspace, cwd: '' } },
      { ...manifest, workspace: { ...manifest.workspace, targetKey: '' } },
      { ...manifest, workspace: { ...manifest.workspace, trusted: true } },
      { ...manifest, files: [{ ...manifest.files[0], requestedPath: ' ' }] },
      { ...manifest, files: [{ ...manifest.files[0], targetKey: '' }] },
      { ...manifest, files: [{ ...manifest.files[0], bytes: -1 }] },
      { ...manifest, files: [{ ...manifest.files[0], bytes: 1.5 }] },
      { ...manifest, files: [{ ...manifest.files[0], verified: true }] },
      { version: 1, coverage: 'no-files-reviewed', files: [], workspace: manifest.workspace },
    ]
    for (const mutation of mutations) expect(() => { validateAuditArtifactManifest(mutation) }).toThrow('artifact evidence')
    expect(() => { validateAuditArtifactManifest(manifest) }).not.toThrow()
    expect(() => { validateAuditArtifactManifest({ version: 1, coverage: 'no-files-reviewed', files: [] }) }).not.toThrow()
  })
})
