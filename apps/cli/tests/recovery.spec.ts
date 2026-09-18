import { createHash } from 'node:crypto'
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectLeonBackupArchive,
  restoreLeonBackupArchive,
  validateLeonBackupManifest,
  writeLeonBackupArchive,
} from '../src/recovery-format.ts'
import type { LeonBackupManifest, LeonBackupSource } from '../src/recovery-format.ts'
import {
  createLeonBackup,
  defaultLeonBackupPath,
  processLeonRestore,
} from '../src/recovery.ts'
import type { BackupCommandOptions, RestoreCommandOptions } from '../src/recovery.ts'

const roots: string[] = []
const PASSPHRASE = 'uma-senha-forte-de-teste'

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leon-recovery-'))
  roots.push(root)
  return root
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

interface Fixture {
  root: string
  home: string
  workspace: string
  output: string
  target: string
  runtime: NonNullable<Parameters<typeof createLeonBackup>[2]>
}

async function fixture(): Promise<Fixture> {
  const root = await temporaryRoot()
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const output = join(root, 'packages', 'state.leon-backup')
  const target = join(root, 'restored-home')
  await mkdir(home)
  await mkdir(workspace)
  await put(join(home, 'settings.yaml'), 'persona: Leon\n')
  await put(join(home, 'AGENTS.md'), 'responda em pt-BR\n')
  await put(join(home, '.credentials.yaml'), 'GEMINI_API_KEY=credential-secret\n')
  await put(join(home, '.anonymous-user-id'), 'telemetry-id\n')
  await put(join(home, 'sessions', 'project', 'session-a', 'session.jsonl.zstd'), 'pasted-session-secret\n')
  await put(join(home, 'sessions', 'project', 'session-a', 'stale.tmp'), 'temporary\n')
  await put(join(home, 'storages', 'workspace.json'), '{"workspaces":[]}\n')
  await put(join(home, 'storages', 'memory_local.json'), '{"memories":["continuity"]}\n')
  await put(join(home, 'storages', 'session_projcache.json'), '{"derived":true}\n')
  await put(join(home, 'attachments', 'v1', 'objects', 'ab', 'abcdef'), 'original-image\n')
  await put(join(home, 'attachments', 'v1', 'request-images', 'ab', 'derived'), 'derived-image\n')
  await put(join(home, 'profiles', 'web', 'package.json'), '{"name":"profile-web"}\n')
  await put(join(home, 'profiles', 'web', 'cordis.patch.yml'), '[]\n')
  await put(join(home, 'profiles', 'web', 'node_modules', 'ignored', 'index.js'), 'ignored\n')
  await put(join(home, 'skills', 'leon-test', 'SKILL.md'), '# Teste\n')
  await put(join(home, 'skills', 'leon-test', '.env'), 'TOKEN=skill-secret\n')
  await put(join(home, 'skills', 'leon-test', '.npmrc'), '//registry/:_authToken=npm-secret\n')
  await put(join(home, 'skills', 'leon-test', 'private.pem'), 'private-key-secret\n')
  await put(join(home, 'skills', 'leon-test', 'credentials.json'), '{"token":"credential-file-secret"}\n')
  await put(join(home, '.agent-presets', 'personal', 'agent.cordis.yml'), 'name: Leon\n')

  const runtime = {
    appVersion: '9.8.7',
    home,
    workspace,
    activeLeon: async () => 'inactive' as const,
    localModels: async () => ({
      source: 'ollama' as const,
      status: 'captured' as const,
      models: ['qwen3.5:9b'],
    }),
    readPassphrase: async () => PASSPHRASE,
  }
  return { root, home, workspace, output, target, runtime }
}

const backupOptions = (output: string, overrides: Partial<BackupCommandOptions> = {}): BackupCommandOptions => ({
  output,
  dryRun: false,
  json: false,
  confirmStopped: true,
  passphraseStdin: false,
  ...overrides,
})

const restoreOptions = (archive: string, target: string, overrides: Partial<RestoreCommandOptions> = {}): RestoreCommandOptions => ({
  archive,
  target,
  apply: false,
  json: false,
  confirmStopped: false,
  passphraseStdin: false,
  ...overrides,
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Leon encrypted recovery', () => {
  it('creates, authenticates, previews, and restores only authoritative state', async () => {
    const state = await fixture()
    const created = await createLeonBackup(backupOptions(state.output), '9.8.7', state.runtime)
    expect(created).toMatchObject({ status: 'created', fileCount: 10, credentialStoreIncluded: false })

    const archiveBytes = await readFile(state.output)
    expect(archiveBytes.subarray(0, 8).toString('ascii')).toBe('LEONBK1\n')
    expect(archiveBytes.includes(Buffer.from('pasted-session-secret'))).toBe(false)
    expect(archiveBytes.includes(Buffer.from('credential-secret'))).toBe(false)

    const manifest = await inspectLeonBackupArchive(state.output, PASSPHRASE)
    const paths = manifest.files.map(file => file.path)
    expect(paths).toEqual([
      '.agent-presets/personal/agent.cordis.yml',
      'AGENTS.md',
      'attachments/v1/objects/ab/abcdef',
      'profiles/web/cordis.patch.yml',
      'profiles/web/package.json',
      'sessions/project/session-a/session.jsonl.zstd',
      'settings.yaml',
      'skills/leon-test/SKILL.md',
      'storages/memory_local.json',
      'storages/workspace.json',
    ])
    expect(manifest.credentialStoreIncluded).toBe(false)
    expect(manifest.workspace).toEqual({ path: state.workspace, contentsIncluded: false })

    const preview = await processLeonRestore(restoreOptions(state.output, state.target), '9.8.7', state.runtime)
    expect(preview.status).toBe('verified')
    await expect(readFile(join(state.target, 'settings.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })

    const restored = await processLeonRestore(restoreOptions(state.output, state.target, {
      apply: true,
      confirmStopped: true,
    }), '9.8.7', state.runtime)
    expect(restored.status).toBe('restored')
    await expect(readFile(join(state.target, 'settings.yaml'), 'utf8')).resolves.toBe('persona: Leon\n')
    await expect(readFile(join(state.target, 'sessions', 'project', 'session-a', 'session.jsonl.zstd'), 'utf8'))
      .resolves.toBe('pasted-session-secret\n')
    await expect(readFile(join(state.target, '.credentials.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(state.target, '.anonymous-user-id'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(state.target, 'storages', 'session_projcache.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(state.target, 'attachments', 'v1', 'request-images', 'ab', 'derived')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed for wrong passwords, tampering, existing targets, and version mismatch', async () => {
    const state = await fixture()
    await createLeonBackup(backupOptions(state.output), '9.8.7', state.runtime)
    await expect(inspectLeonBackupArchive(state.output, 'senha-totalmente-incorreta'))
      .rejects.toThrow('senha incorreta ou pacote adulterado')

    const tampered = join(state.root, 'tampered.leon-backup')
    const bytes = await readFile(state.output)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    await writeFile(tampered, bytes)
    await expect(inspectLeonBackupArchive(tampered, PASSPHRASE)).rejects.toThrow('integridade')
    const tamperedTarget = join(state.root, 'tampered-target')
    await expect(restoreLeonBackupArchive(tampered, tamperedTarget, PASSPHRASE)).rejects.toThrow('integridade')
    expect((await readdir(state.root)).some(name => name.startsWith('.tampered-target.restore-'))).toBe(false)

    await mkdir(state.target)
    await put(join(state.target, 'sentinel.txt'), 'preserve-me')
    await expect(restoreLeonBackupArchive(state.output, state.target, PASSPHRASE)).rejects.toThrow('já existe')
    await expect(readFile(join(state.target, 'sentinel.txt'), 'utf8')).resolves.toBe('preserve-me')

    const otherTarget = join(state.root, 'wrong-version')
    await expect(processLeonRestore(restoreOptions(state.output, otherTarget, {
      apply: true,
      confirmStopped: true,
    }), '1.0.0', state.runtime)).rejects.toThrow('exige Leon 9.8.7')
    await expect(readFile(join(otherTarget, 'settings.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })

    const sentinelArchive = join(state.root, 'existing.leon-backup')
    await writeFile(sentinelArchive, 'preserve-archive')
    await expect(createLeonBackup(backupOptions(sentinelArchive), '9.8.7', state.runtime)).rejects.toThrow('já existe')
    await expect(readFile(sentinelArchive, 'utf8')).resolves.toBe('preserve-archive')
  })

  it('requires explicit offline confirmation and blocks an observable running Web service', async () => {
    const state = await fixture()
    await expect(createLeonBackup(backupOptions(state.output, { confirmStopped: false }), '9.8.7', state.runtime))
      .rejects.toThrow('--confirm-stopped')
    const activeRuntime = { ...state.runtime, activeLeon: async () => 'active' as const }
    await expect(createLeonBackup(backupOptions(state.output), '9.8.7', activeRuntime))
      .rejects.toThrow('porta 3080')
    const unknownRuntime = { ...state.runtime, activeLeon: async () => 'unknown' as const }
    await expect(createLeonBackup(backupOptions(state.output), '9.8.7', unknownRuntime))
      .rejects.toThrow('não foi possível comprovar')
    await expect(readFile(state.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('dry-runs without prompting or creating its destination', async () => {
    const state = await fixture()
    let prompted = false
    const runtime = { ...state.runtime, readPassphrase: async () => { prompted = true; return PASSPHRASE } }
    const report = await createLeonBackup(backupOptions(state.output, {
      dryRun: true,
      confirmStopped: false,
    }), '9.8.7', runtime)
    expect(report.status).toBe('planned')
    expect(prompted).toBe(false)
    await expect(readFile(state.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects hardlinked state and never publishes a source with the wrong hash', async () => {
    const state = await fixture()
    const outside = join(state.root, 'outside-secret')
    await writeFile(outside, 'outside')
    await link(outside, join(state.home, 'skills', 'leon-test', 'hardlink.txt'))
    await expect(createLeonBackup(backupOptions(state.output, { dryRun: true }), '9.8.7', state.runtime))
      .rejects.toThrow('arquivo regular exclusivo')
    await rm(join(state.home, 'skills', 'leon-test', 'hardlink.txt'))

    const sourcePath = join(state.root, 'manual-source')
    await writeFile(sourcePath, 'content')
    const file = { path: 'settings.yaml', size: 7, sha256: '0'.repeat(64), mode: 0o600 }
    const metadata = await lstat(sourcePath, { bigint: true })
    const source: LeonBackupSource = {
      absolutePath: sourcePath,
      canonicalPath: await realpath(sourcePath),
      identity: {
        dev: metadata.dev.toString(),
        ino: metadata.ino.toString(),
        size: metadata.size.toString(),
        mtimeNs: metadata.mtimeNs.toString(),
        ctimeNs: metadata.ctimeNs.toString(),
      },
      file,
    }
    const manifest = validManifest([file])
    await expect(writeLeonBackupArchive(state.output, manifest, [source], PASSPHRASE)).rejects.toThrow('mudou durante o snapshot')
    await expect(readFile(state.output)).rejects.toMatchObject({ code: 'ENOENT' })

    const correctFile = { ...file, sha256: createHash('sha256').update('content').digest('hex') }
    await expect(writeLeonBackupArchive(
      state.output,
      validManifest([correctFile]),
      [{ ...source, file: correctFile }],
      PASSPHRASE,
      { beforeCommit: async () => { throw new Error('late coordination failure') } },
    )).rejects.toThrow('late coordination failure')
    await expect(readFile(state.output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(join(state.root, 'packages')))
      .filter(name => name.endsWith('.tmp') || name.includes('.build-'))).toEqual([])

    const publication = await writeLeonBackupArchive(
      state.output,
      validManifest([correctFile]),
      [{ ...source, file: correctFile }],
      PASSPHRASE,
      { afterPublish: async () => { throw new Error('simulated post-publication warning') } },
    )
    expect(publication).toMatchObject({
      published: true,
      temporaryCleanupConfirmed: true,
      directorySyncConfirmed: true,
    })
    expect(publication.warnings).toEqual([expect.stringContaining('simulated post-publication warning')])
    await expect(inspectLeonBackupArchive(state.output, PASSPHRASE)).resolves.toMatchObject({ product: 'Leon' })
    await rm(state.output)

    await writeFile(sourcePath, 'content appended')
    await expect(writeLeonBackupArchive(
      state.output,
      validManifest([correctFile]),
      [{ ...source, file: correctFile }],
      PASSPHRASE,
    )).rejects.toThrow('origem mudou')
    await expect(readFile(state.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects traversal, Windows aliases, duplicates, case collisions, and file-directory conflicts', () => {
    for (const path of [
      '../outside', 'C:/outside', '//server/share', 'sessions\\evil',
      'sessions/NUL/file', 'sessions/COM¹/file', 'sessions/LPT²/file', 'sessions/name.',
    ]) {
      expect(() => { validateLeonBackupManifest(validManifest([validFile(path)])) }).toThrow()
    }
    expect(() => { validateLeonBackupManifest(validManifest([
      validFile('sessions/A/session.jsonl'),
      validFile('sessions/a/session.jsonl'),
    ])) }).toThrow('colidente')
    expect(() => { validateLeonBackupManifest(validManifest([
      validFile('skills/tool'),
      validFile('skills/tool/file'),
    ])) }).toThrow('conflito')
    for (const path of [
      'storages/credentials.json',
      'sessions/project/arbitrary.txt',
      'attachments/v1/request-images/ab/file',
      'skills/tool/.env',
    ]) {
      expect(() => { validateLeonBackupManifest(validManifest([validFile(path)])) }).toThrow('escopo não permitido')
    }
  })

  it('serializes concurrent restores and fails closed on a stale restore lock', async () => {
    const state = await fixture()
    await createLeonBackup(backupOptions(state.output), '9.8.7', state.runtime)

    const outcomes = await Promise.allSettled([
      restoreLeonBackupArchive(state.output, state.target, PASSPHRASE, '9.8.7'),
      restoreLeonBackupArchive(state.output, state.target, PASSPHRASE, '9.8.7'),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(readFile(join(state.target, 'settings.yaml'), 'utf8')).resolves.toBe('persona: Leon\n')
    await expect(readFile(join(state.root, '.restored-home.restore.lock'))).rejects.toMatchObject({ code: 'ENOENT' })

    const lockedTarget = join(state.root, 'locked-home')
    await writeFile(join(state.root, '.locked-home.restore.lock'), 'interrupted restore')
    await expect(restoreLeonBackupArchive(state.output, lockedTarget, PASSPHRASE, '9.8.7'))
      .rejects.toThrow('outra restauração')
    await expect(readFile(lockedTarget)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not replace a destination created after the initial existence check', async () => {
    const state = await fixture()
    await createLeonBackup(backupOptions(state.output), '9.8.7', state.runtime)

    await expect(restoreLeonBackupArchive(state.output, state.target, PASSPHRASE, '9.8.7', {
      beforePublish: async () => { await mkdir(state.target) },
    })).rejects.toThrow('já existe')
    await expect(readFile(join(state.target, 'settings.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never publishes an unauthenticated partial when the open package changes between passes', async () => {
    const state = await fixture()
    await createLeonBackup(backupOptions(state.output), '9.8.7', state.runtime)
    let failure: unknown
    try {
      await restoreLeonBackupArchive(state.output, state.target, PASSPHRASE, '9.8.7', {
        afterVerification: async () => {
          const handle = await open(state.output, 'r+')
          try {
            const metadata = await handle.stat()
            const last = Buffer.alloc(1)
            await handle.read(last, 0, 1, metadata.size - 1)
            last[0] = (last[0] ?? 0) ^ 0xff
            await handle.write(last, 0, 1, metadata.size - 1)
            await handle.sync()
          } finally {
            await handle.close()
          }
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/staging incompleto e não confiável preservado/u)
    const stagingPath = /diagnóstico: (.+)$/u.exec(String(failure))?.[1] ?? ''
    expect(stagingPath).not.toBe('')
    const entries = await readdir(stagingPath, { recursive: true })
    expect(entries.some(name => name.endsWith('.part'))).toBe(false)
    await expect(readFile(join(state.target, 'settings.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the stable workspace backup directory by default', () => {
    expect(defaultLeonBackupPath('E:/computador', new Date('2026-08-27T12:34:56.789Z')))
      .toContain(join('E:', 'computador', 'Backups', 'Leon', 'leon-2026-08-27T12-34-56-789Z.leon-backup'))
  })
})

function validFile(path: string): LeonBackupManifest['files'][number] {
  return { path, size: 0, sha256: '0'.repeat(64), mode: 0o600 }
}

function validManifest(files: readonly LeonBackupManifest['files'][number][]): LeonBackupManifest {
  return {
    schemaVersion: 1,
    product: 'Leon',
    snapshotId: '00000000-0000-4000-8000-000000000000',
    createdAt: '2026-08-27T12:00:00.000Z',
    source: { leonVersion: '9.8.7', platform: process.platform, arch: process.arch, nodeVersion: process.versions.node },
    workspace: { path: 'E:/computador', contentsIncluded: false },
    localModels: { source: 'ollama', status: 'unavailable', models: [] },
    credentialStoreIncluded: false,
    anonymousIdentityIncluded: false,
    exclusions: [],
    files,
  }
}
