import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL(
  '../config/agent-presets/leon/skills/leon-browser/scripts/context.mjs',
  import.meta.url,
))
const cli = fileURLToPath(new URL('./fixtures/leon-browser-context/fake-playwright-cli.mjs', import.meta.url))
const temporaryDirectories: string[] = []

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'leon-browser-context-'))
  temporaryDirectories.push(directory)
  return directory
}

async function run(dshHome: string, args: string[], environment: Record<string, string> = {}) {
  const result = await execa(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_NODE: process.execPath,
      DSH_PLAYWRIGHT_CLI: cli,
      NO_UPDATE_NOTIFIER: '1',
      ...environment,
    },
    reject: false,
  })
  return {
    exitCode: result.exitCode,
    body: JSON.parse(result.stdout) as Record<string, unknown>,
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Leon browser context helper', () => {
  it('captures bounded active-page context and reuses the local cache', async () => {
    const dshHome = await home()
    const inspected = await run(dshHome, ['inspect', '--session', 'leon', '--depth', '6', '--max-chars', '1200'], {
      BROWSER_CONTEXT_PROBE_TOKEN: 'must-not-reach-child',
    })
    const context = (inspected.body.context ?? {}) as Record<string, unknown>
    const page = (context.page ?? {}) as Record<string, unknown>

    expect(inspected.exitCode).toBe(0)
    expect(inspected.body).toMatchObject({ ok: true, command: 'inspect', available: true })
    expect(page).toEqual({
      url: 'https://example.test/dashboard?view=tasks#active',
      title: 'Painel Leon',
      route: '/dashboard?view=tasks#active',
      readyState: 'complete',
    })
    expect(context).toMatchObject({ snapshotTruncated: true })
    expect(String(context.accessibilitySnapshot)).toContain('Nova tarefa')
    expect(String(context.accessibilitySnapshot).length).toBe(1200)

    const cached = await run(dshHome, ['status', '--session', 'leon'])
    expect(cached.body).toMatchObject({ ok: true, command: 'status', available: true })
    expect((cached.body.context as Record<string, unknown>).snapshotId).toBe(context.snapshotId)
  })

  it('reports an unavailable session without inventing page state', async () => {
    const dshHome = await home()
    await run(dshHome, ['inspect'])
    const result = await run(dshHome, ['inspect'], { BROWSER_CONTEXT_FIXTURE: 'missing' })

    expect(result).toMatchObject({
      exitCode: 0,
      body: {
        ok: true,
        command: 'inspect',
        available: false,
        reason: 'SESSION_UNAVAILABLE',
        discardedCachedContext: true,
      },
    })
    expect((await run(dshHome, ['status'])).body).toMatchObject({
      ok: true, available: false, reason: 'NO_CACHED_CONTEXT',
    })
  })

  it('clears only the selected cached session', async () => {
    const dshHome = await home()
    await run(dshHome, ['inspect'])

    expect((await run(dshHome, ['clear'])).body).toMatchObject({ ok: true, removed: true, session: 'leon' })
    expect((await run(dshHome, ['clear'])).body).toMatchObject({ ok: true, removed: false, session: 'leon' })
  })

  it('rejects unsafe session names and unbounded snapshots', async () => {
    const dshHome = await home()
    const session = await run(dshHome, ['status', '--session', '../escape'])
    const limit = await run(dshHome, ['inspect', '--max-chars', '999999'])

    expect(session).toMatchObject({ exitCode: 1, body: { ok: false, error: { code: 'INVALID_SESSION' } } })
    expect(limit).toMatchObject({ exitCode: 1, body: { ok: false, error: { code: 'INVALID_ARGUMENTS' } } })
  })
})
