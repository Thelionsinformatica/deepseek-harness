import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function boot(path: string): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('native Windows credential protection', () => {
  it.skipIf(process.platform !== 'win32')('persists and reopens a synthetic credential through DPAPI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-native-dpapi-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, '.credentials.yaml')
    const ref = credentialRef('DSH_CRED_NATIVE_DPAPI_TEST')
    const first = await boot(path)
    await first.credentials.set(ref, 'synthetic-native-dpapi-value')

    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('protection: windows-dpapi-current-user')
    expect(stored).not.toContain('synthetic-native-dpapi-value')
    expect(stored).not.toContain('DSH_CRED_NATIVE_DPAPI_TEST')

    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(ref))
      .toEqual({ value: 'synthetic-native-dpapi-value', source: 'file' })
  })

  it.skipIf(process.platform !== 'win32')('migrates a synthetic plaintext document without an intermediate write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-native-migration-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, '.credentials.yaml')
    const ref = credentialRef('DSH_CRED_NATIVE_MIGRATION_TEST')
    await writeFile(path, 'version: 1\nrefs:\n  DSH_CRED_NATIVE_MIGRATION_TEST: synthetic-legacy-value\n', { mode: 0o600 })

    const migrated = await boot(path)
    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('protection: windows-dpapi-current-user')
    expect(stored).not.toContain('synthetic-legacy-value')
    expect(stored).not.toContain('DSH_CRED_NATIVE_MIGRATION_TEST')
    expect(await migrated.credentials.resolve(ref)).toEqual({ value: 'synthetic-legacy-value', source: 'file' })
  })
})
