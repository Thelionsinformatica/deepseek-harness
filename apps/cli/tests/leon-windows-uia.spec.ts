import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL(
  '../config/agent-presets/leon/skills/leon-windows/scripts/uia.ps1',
  import.meta.url,
))
const testWindow = fileURLToPath(new URL('./fixtures/leon-windows-uia/test-window.ps1', import.meta.url))
const temporaryDirectories: string[] = []
const windowsDescribe = process.platform === 'win32' ? describe : describe.skip

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'leon-windows-uia-'))
  temporaryDirectories.push(directory)
  return directory
}

async function run(dshHome: string, args: string[]) {
  const result = await execa('pwsh', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...args,
  ], {
    env: { ...process.env, DSH_HOME: dshHome },
    reject: false,
  })
  return {
    exitCode: result.exitCode,
    body: JSON.parse(result.stdout) as Record<string, unknown>,
  }
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(path)
      return
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

windowsDescribe('Leon Windows UI Automation connector', () => {
  it('lists top-level windows without changing desktop state', async () => {
    const result = await run(await home(), ['windows', '-MaxWindows', '10'])

    expect(result.exitCode).toBe(0)
    expect(result.body).toMatchObject({ ok: true, command: 'windows' })
    expect(Array.isArray(result.body.windows)).toBe(true)
    expect((result.body.windows as unknown[]).length).toBeLessThanOrEqual(10)
  })

  it('returns a bounded accessibility tree when a focused window is available', async () => {
    const result = await run(await home(), ['inspect', '-Depth', '2', '-MaxNodes', '12'])

    expect(result.exitCode).toBe(0)
    expect(result.body).toMatchObject({ ok: true, command: 'inspect' })
    if (result.body.available === true) {
      expect(Array.isArray(result.body.controls)).toBe(true)
      expect((result.body.controls as unknown[]).length).toBeLessThanOrEqual(12)
      expect(result.body).toMatchObject({ depthLimit: 2, nodeLimit: 12 })
    }
    else {
      expect(result.body).toMatchObject({ available: false, reason: 'FOCUSED_WINDOW_UNAVAILABLE' })
    }
  })

  it('rejects mutations without an exact allowlist and records the attempt locally', async () => {
    const dshHome = await home()
    const denied = await run(dshHome, ['set-value', '-AutomationId', 'Editor', '-Value', 'must-not-be-logged'])

    expect(denied).toMatchObject({
      exitCode: 1,
      body: {
        ok: false,
        command: 'set-value',
        error: { code: 'ALLOWLIST_REQUIRED' },
        auditRecorded: true,
      },
    })

    const audit = await run(dshHome, ['audit', '-Limit', '10'])
    expect(audit.exitCode).toBe(0)
    expect(audit.body).toMatchObject({ ok: true, command: 'audit' })
    expect(JSON.stringify(audit.body)).not.toContain('must-not-be-logged')
    expect(audit.body.events).toEqual([
      expect.objectContaining({ command: 'set-value', status: 'failed', errorCode: 'ALLOWLIST_REQUIRED' }),
    ])
  })

  it('rejects a mismatched window allowlist before resolving the target', async () => {
    const result = await run(await home(), [
      'invoke',
      '-WindowId', '1:1',
      '-AllowWindowId', '1:2',
      '-AllowProcess', 'notepad',
      '-AutomationId', 'SaveButton',
    ])

    expect(result).toMatchObject({
      exitCode: 1,
      body: { ok: false, error: { code: 'ALLOWLIST_MISMATCH' }, auditRecorded: true },
    })
  })

  it('fills and invokes an allowed test window, captures it, and audits each action', async () => {
    const dshHome = await home()
    const markerPath = join(dshHome, 'invoked.txt')
    const readyPath = join(dshHome, 'ready.txt')
    const screenshotPath = join(dshHome, 'window.png')
    const title = `Leon UIA Test ${Date.now()}`
    const fixture = execa('pwsh', [
      '-NoLogo', '-NoProfile', '-STA', '-File', testWindow,
      '-MarkerPath', markerPath,
      '-ReadyPath', readyPath,
      '-Title', title,
    ], { reject: false, windowsHide: true })

    try {
      await waitForFile(readyPath)
      const listed = await run(dshHome, ['windows', '-MaxWindows', '200'])
      const window = (listed.body.windows as Array<Record<string, unknown>>)
        .find(candidate => candidate.name === title)
      expect(window).toBeDefined()
      const windowId = String(window?.windowId)
      const processName = String(window?.processName)

      const filled = await run(dshHome, [
        'set-value',
        '-WindowId', windowId,
        '-AllowWindowId', windowId,
        '-AllowProcess', processName,
        '-AutomationId', 'LeonEditor',
        '-Value', 'conteudo autorizado',
      ])
      expect(filled).toMatchObject({
        exitCode: 0,
        body: { ok: true, result: { pattern: 'ValuePattern', valueLength: 19 }, auditRecorded: true },
      })

      const invoked = await run(dshHome, [
        'invoke',
        '-WindowId', windowId,
        '-AllowWindowId', windowId,
        '-AllowProcess', processName,
        '-AutomationId', 'LeonActionButton',
      ])
      expect(invoked).toMatchObject({
        exitCode: 0,
        body: { ok: true, result: { pattern: 'InvokePattern' }, auditRecorded: true },
      })
      await waitForFile(markerPath)
      expect(await readFile(markerPath, 'utf8')).toBe('conteudo autorizado')

      const screenshot = await run(dshHome, [
        'screenshot',
        '-WindowId', windowId,
        '-AllowWindowId', windowId,
        '-AllowProcess', processName,
        '-OutputPath', screenshotPath,
      ])
      expect(screenshot).toMatchObject({ exitCode: 0, body: { ok: true, auditRecorded: true } })
      expect((await stat(screenshotPath)).size).toBeGreaterThan(0)

      const audit = await run(dshHome, ['audit', '-Limit', '10'])
      expect((audit.body.events as unknown[]).length).toBe(3)
      expect(JSON.stringify(audit.body)).not.toContain('conteudo autorizado')
    }
    finally {
      fixture.kill('SIGTERM')
      await fixture.catch(() => undefined)
    }
  }, 30_000)
})
