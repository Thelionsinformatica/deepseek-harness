import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'
import {
  createWindowsDpapiProtector,
  WINDOWS_DPAPI_PROTECTION,
} from '../src/windows-protection.ts'

const protectionHarness = vi.hoisted(() => {
  const marker = Buffer.from('synthetic-dpapi:')
  const transform = (input: Buffer): Buffer => {
    const output = Buffer.allocUnsafe(input.length)
    for (let index = 0; index < input.length; index += 1) output[index] = input[index]! ^ 0xa5
    return output
  }
  return {
    failProtect: false,
    failUnprotect: false,
    mismatchUnprotect: false,
    invalidUtf8: false,
    marker,
    protect: vi.fn(async (plaintext: Buffer): Promise<Buffer> => {
      if (protectionHarness.failProtect) throw new Error('synthetic protection failure')
      return Buffer.concat([marker, transform(plaintext)])
    }),
    unprotect: vi.fn(async (ciphertext: Buffer): Promise<Buffer> => {
      if (protectionHarness.failUnprotect) throw new Error('synthetic decryption failure')
      if (protectionHarness.invalidUtf8) return Buffer.from([0xff])
      if (!ciphertext.subarray(0, marker.length).equals(marker)) throw new Error('synthetic payload mismatch')
      const plaintext = transform(ciphertext.subarray(marker.length))
      return protectionHarness.mismatchUnprotect ? Buffer.concat([plaintext, Buffer.from('mismatch')]) : plaintext
    }),
  }
})

vi.mock('../src/windows-protection.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/windows-protection.ts')>()
  return {
    ...actual,
    credentialProtectorForPlatform: () => ({
      kind: actual.WINDOWS_DPAPI_PROTECTION,
      protect: protectionHarness.protect,
      unprotect: protectionHarness.unprotect,
    }),
  }
})

const KEY = credentialRef('DSH_CRED_PROTECTED_TEST')
const OTHER = credentialRef('DSH_CRED_PROTECTED_OTHER')
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  protectionHarness.failProtect = false
  protectionHarness.failUnprotect = false
  protectionHarness.mismatchUnprotect = false
  protectionHarness.invalidUtf8 = false
  protectionHarness.protect.mockClear()
  protectionHarness.unprotect.mockClear()
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-protection-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(path: string): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

function writeCredentials(path: string, text: string): Promise<void> {
  return writeFile(path, text, { mode: 0o600 })
}

describe('Windows protected document', () => {
  it('writes only a versioned DPAPI envelope and reads it after restart', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const first = await boot(path)
    await first.credentials.set(KEY, 'synthetic-secret-value')

    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('version: 2')
    expect(stored).toContain(`protection: ${WINDOWS_DPAPI_PROTECTION}`)
    expect(stored).not.toContain('synthetic-secret-value')
    expect(stored).not.toContain('DSH_CRED_PROTECTED_TEST')
    expect(protectionHarness.protect).toHaveBeenCalledTimes(1)
    expect(protectionHarness.unprotect).toHaveBeenCalledTimes(1)

    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(KEY)).toEqual({ value: 'synthetic-secret-value', source: 'file' })
    expect(protectionHarness.unprotect).toHaveBeenCalledTimes(2)
    expect(await readFile(path, 'utf8')).toBe(stored)
  })

  it('migrates a plaintext version-1 document under the writer lock at boot', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const legacy = 'version: 1\nrefs:\n  # retained inside the protected payload\n  DSH_CRED_PROTECTED_TEST: legacy-value\n'
    await writeCredentials(path, legacy)

    const ctx = await boot(path)
    const stored = await readFile(path, 'utf8')
    expect(stored).not.toBe(legacy)
    expect(stored).not.toContain('legacy-value')
    expect(stored).not.toContain('retained inside')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'legacy-value', source: 'file' })
    expect(protectionHarness.protect).toHaveBeenCalledTimes(1)

    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(KEY)).toEqual({ value: 'legacy-value', source: 'file' })
    expect(protectionHarness.protect).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(stored)
  })

  it('protects records and preserves them beside references across restart', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path)
    const recordKey = credentialKey('llm-pi-ai', 'synthetic-protected')
    await ctx.credentials.set(KEY, 'reference-value')
    await ctx.credentials.modifyRecord(recordKey, () => Promise.resolve({
      kind: 'grant',
      payload: { access: 'synthetic-access', refresh: 'synthetic-refresh' },
    }))

    const stored = await readFile(path, 'utf8')
    expect(stored).not.toContain('reference-value')
    expect(stored).not.toContain('synthetic-access')
    expect(stored).not.toContain('llm-pi-ai/synthetic-protected')
    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(KEY)).toEqual({ value: 'reference-value', source: 'file' })
    expect(await restarted.credentials.readRecord(recordKey)).toEqual({
      kind: 'grant',
      payload: { access: 'synthetic-access', refresh: 'synthetic-refresh' },
    })
  })

  it('migrates a records-only version-1 document', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const recordKey = credentialKey('llm-pi-ai', 'records-only')
    await writeCredentials(path, [
      'version: 1',
      'records:',
      '  llm-pi-ai/records-only:',
      '    kind: api-key',
      '    key: synthetic-record-only-value',
      '',
    ].join('\n'))

    const ctx = await boot(path)
    expect(await readFile(path, 'utf8')).not.toContain('synthetic-record-only-value')
    expect(await ctx.credentials.readRecord(recordKey))
      .toEqual({ kind: 'api-key', key: 'synthetic-record-only-value' })
  })

  it('folds another protected writer into the locked read-modify-write', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const first = await boot(path)
    const second = await boot(path)

    await first.credentials.set(KEY, 'first-protected-value')
    await second.credentials.set(OTHER, 'second-protected-value')

    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(KEY)).toEqual({ value: 'first-protected-value', source: 'file' })
    expect(await restarted.credentials.resolve(OTHER)).toEqual({ value: 'second-protected-value', source: 'file' })
  })

  it('combines the pre-release flat-layout upgrade with DPAPI protection', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'DSH_CRED_PROTECTED_TEST: flat-legacy-value\n')

    const ctx = await boot(path)
    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('version: 2')
    expect(stored).not.toContain('flat-legacy-value')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'flat-legacy-value', source: 'file' })
  })

  it('leaves plaintext byte-for-byte intact when migration protection fails', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const legacy = 'version: 1\nrefs:\n  DSH_CRED_PROTECTED_TEST: migration-must-survive\n'
    await writeCredentials(path, legacy)
    protectionHarness.failProtect = true

    const ctx = new Context()
    await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false }))
      .rejects.toThrow(/could not protect/)
    expect(await readFile(path, 'utf8')).toBe(legacy)
  })

  it('leaves plaintext byte-for-byte intact when migration verification fails', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const legacy = 'version: 1\nrefs:\n  DSH_CRED_PROTECTED_TEST: verification-must-survive\n'
    await writeCredentials(path, legacy)
    protectionHarness.failUnprotect = true

    const ctx = new Context()
    await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false }))
      .rejects.toThrow(/could not verify protection/)
    expect(await readFile(path, 'utf8')).toBe(legacy)
  })

  it('leaves plaintext intact when protection returns a non-round-tripping payload', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const legacy = 'version: 1\nrefs:\n  DSH_CRED_PROTECTED_TEST: comparison-must-survive\n'
    await writeCredentials(path, legacy)
    protectionHarness.mismatchUnprotect = true

    const ctx = new Context()
    await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false }))
      .rejects.toThrow(/protection verification failed/)
    expect(await readFile(path, 'utf8')).toBe(legacy)
  })

  it('fails loud for a payload the current Windows user cannot decrypt', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const first = await boot(path)
    await first.credentials.set(KEY, 'bound-user-value')
    const stored = await readFile(path, 'utf8')
    protectionHarness.failUnprotect = true

    const ctx = new Context()
    await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false }))
      .rejects.toThrow(/could not decrypt .* current Windows user/)
    expect(await readFile(path, 'utf8')).toBe(stored)
  })

  it('rejects a live plaintext downgrade instead of silently resuming plaintext writes', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path)
    await ctx.credentials.set(KEY, 'protected-value')
    const downgraded = 'version: 1\nrefs:\n  DSH_CRED_PROTECTED_TEST: external-plaintext\n'
    await writeCredentials(path, downgraded)

    await expect(ctx.credentials.set(KEY, 'replacement')).rejects.toThrow(/restart to migrate them under DPAPI/)
    expect(await readFile(path, 'utf8')).toBe(downgraded)
  })

  it('rejects malformed envelope metadata without quoting the payload', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const invalidPayload = 'not_a_secret_but_still_private'
    await writeCredentials(path, [
      'version: 2',
      `protection: ${WINDOWS_DPAPI_PROTECTION}`,
      `payload: ${invalidPayload}`,
      '',
    ].join('\n'))

    const ctx = new Context()
    let message = ''
    try {
      await ctx.plugin(LocalCredentialProvider, { path, watch: false })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/protected payload/)
    expect(message).not.toContain(invalidPayload)
  })

  it.each([
    ['an extra field', 'version: 2\nprotection: windows-dpapi-current-user\npayload: c3ludGhldGlj\n'
      + 'sk-live-PROTECTED-DIAGNOSTIC-SENTINEL: {}\n', /contains an unknown top-level key/],
    ['an unsupported mechanism', 'version: 2\nprotection: other\npayload: c3ludGhldGlj\n',
      /unsupported credential protection mechanism/],
    ['a non-string payload', 'version: 2\nprotection: windows-dpapi-current-user\npayload: 123\n',
      /protected payload .* must be a string/],
    ['an empty payload', 'version: 2\nprotection: windows-dpapi-current-user\npayload: ""\n',
      /not valid base64/],
    ['a non-multiple-of-four payload', 'version: 2\nprotection: windows-dpapi-current-user\npayload: abc\n',
      /not valid base64/],
    ['a non-base64 payload', 'version: 2\nprotection: windows-dpapi-current-user\npayload: ab_c\n',
      /not valid base64/],
    ['a non-canonical payload', 'version: 2\nprotection: windows-dpapi-current-user\npayload: ZE==\n',
      /not canonical base64/],
  ])('rejects %s', async (_case, text, message) => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, text)
    const ctx = new Context()
    let failure: unknown
    try {
      await ctx.plugin(LocalCredentialProvider, { path, watch: false })
    } catch (error) {
      failure = error
    }

    expect(String(failure)).toMatch(message)
    expect(String(failure)).not.toContain('sk-live-PROTECTED-DIAGNOSTIC-SENTINEL')
    expect((failure as Error).stack ?? '').not.toContain('sk-live-PROTECTED-DIAGNOSTIC-SENTINEL')
  })

  it('rejects decrypted bytes that are not UTF-8', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, [
      'version: 2',
      'protection: windows-dpapi-current-user',
      'payload: c3ludGhldGlj',
      '',
    ].join('\n'))
    protectionHarness.invalidUtf8 = true
    const ctx = new Context()

    await expect(ctx.plugin(LocalCredentialProvider, { path, watch: false })).rejects.toThrow(/is not UTF-8/)
  })
})

describe('DPAPI adapter', () => {
  it('routes protect and unprotect through the supplied binary runner', async () => {
    const run = vi.fn(async (_operation: 'protect' | 'unprotect', input: Buffer) => Buffer.from(input).reverse())
    const protector = createWindowsDpapiProtector(run)

    expect(await protector.protect(Buffer.from('one'))).toEqual(Buffer.from('eno'))
    expect(await protector.unprotect(Buffer.from('two'))).toEqual(Buffer.from('owt'))
    expect(run.mock.calls.map(([operation]) => operation)).toEqual(['protect', 'unprotect'])
  })

  it.skipIf(process.platform !== 'win32')('round-trips synthetic bytes through real current-user DPAPI', async () => {
    const protector = createWindowsDpapiProtector()
    const plaintext = Buffer.from('synthetic-real-dpapi-round-trip', 'utf8')
    const ciphertext = await protector.protect(plaintext)
    expect(ciphertext.equals(plaintext)).toBe(false)
    const recovered = await protector.unprotect(ciphertext)
    expect(recovered).toEqual(plaintext)
    plaintext.fill(0)
    ciphertext.fill(0)
    recovered.fill(0)
  })
})
