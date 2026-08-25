/**
 * Web runtime glue behavior: dist resolution through the bundle's own hook,
 * the frontend-static child claiming the fallback seat, the web-surface
 * prompt section and bash runtime variables, and readiness publication through
 * the URL line and default-browser handoff.
 */

import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, internals } from '../src/index.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

let dist: string | undefined

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
  vi.unstubAllEnvs()
  internals.resolveDistIndex = originalResolve
  internals.openBrowser = originalOpenBrowser
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

const originalResolve = internals.resolveDistIndex
const originalOpenBrowser = internals.openBrowser

type BrowserLauncher = ChildProcess & { stderr: PassThrough }

/** Minimal browser-launcher process for the native handoff adapter. */
function launcher(): BrowserLauncher {
  return Object.assign(new EventEmitter(), { stderr: new PassThrough() }) as unknown as BrowserLauncher
}

/** Stage a dist fixture and point the bundle's resolver at it. */
function stageDist(): string {
  dist = mkdtempSync(join(tmpdir(), 'dsh-web-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
  return index
}

/** A fake webServer capturing the fallback seat and index taps. */
function fakeHttpServer(host: '127.0.0.1' | '0.0.0.0' = '127.0.0.1'): { server: WebServer; seat: () => unknown } {
  let fallback: unknown
  const server = {
    host,
    port: 4567,
    register: () => () => {},
    registerFallback: (handler: unknown) => {
      fallback = handler
      return () => { fallback = undefined }
    },
    renderIndex: (html: string) => html,
  } as unknown as WebServer
  return { server, seat: () => fallback }
}

/** A fake Loader whose settlement the test controls (the URL line waits on it). */
function provideLoader(ctx: Context, settle: () => Promise<void> = async () => {}): void {
  ctx.provide('loader', { await: settle } as never)
}

interface BashContribution {
  name: string
  variables: Record<string, { description: string }>
  resolve: () => Record<string, string>
}

describe('web-app runtime glue', () => {
  it('pins Leon Automatic to Qwen/Ornith locally without automatic external failover', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const start = patch.indexOf('    - id: api-gateway')
    const end = patch.indexOf('\n    - id:', start + 1)
    const gateway = patch.slice(start, end)
    expect(gateway).toContain('provider: ollama')
    expect(gateway).toContain('fastProvider: ollama')
    expect(gateway).toContain('mainProvider: ollama')
    expect(gateway).toContain('expertProvider: ollama')
    expect(gateway).toContain('fastModel: qwen3.5:9b')
    expect(gateway).toContain('mainModel: qwen3.5:9b')
    expect(patch).not.toContain('qwen3.5:4b')
    expect(gateway).toContain('expertModel: ornith-1.5:9b')
    expect(gateway).toContain('mainReasoningEffort: medium')
    expect(gateway).toContain('fromRound: 1')
    expect(gateway).toContain('model: ornith-1.5:9b')
    expect(gateway).not.toContain('failovers:')
    expect(gateway).toContain('never\n        # fails over automatically to an external API')
    expect(gateway).toContain('policyVersion: leon-shadow-v1')
    expect(gateway).toContain('externalPolicy: fallback-only')
    expect(gateway).toContain('residency: local')
    expect(gateway).toContain('residency: external')
    expect(gateway).not.toMatch(/(?:provider|fastModel|mainModel|expertModel|model):.*deepseek/iu)
    expect(patch).toContain("- id: ui-voice\n      name: '@deepseek-ai/dsh-client-ui-voice'")
    expect(patch).toContain("- id: lsp\n      name: '@deepseek-ai/dsh-lsp'")
    expect(patch).toContain("- id: lsp-stdio\n      name: '@deepseek-ai/dsh-lsp-stdio'")
    expect(patch).toContain('typescript-language-server/lib/cli.mjs')
    expect(patch).toContain('.tsx: typescriptreact')

    const parsed = yaml.load(patch, { schema: entryListSchema })
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown> }[] }[])
      .flatMap(entry => entry.insert ?? [])
    expect(rows.find(row => row.id === 'api-gateway')?.config).toMatchObject({
      adaptiveRouting: {
        expertProvider: 'ollama',
        expertModel: 'ornith-1.5:9b',
        goalRoundTiers: [{
          fromRound: 1, provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high',
        }],
      },
    })
    expect((rows.find(row => row.id === 'api-gateway')?.config as {
      adaptiveRouting?: { failovers?: unknown }
    } | undefined)?.adaptiveRouting?.failovers).toBeUndefined()
    const shadow = (rows.find(row => row.id === 'api-gateway')?.config as {
      adaptiveRouting?: {
        shadow?: {
          policyVersion: string
          externalPolicy: string
          routes: Array<{ provider: string; model: string; residency: string }>
        }
      }
    } | undefined)?.adaptiveRouting?.shadow
    expect(shadow).toMatchObject({
      policyVersion: 'leon-shadow-v1',
      externalPolicy: 'fallback-only',
    })
    expect(shadow?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'ollama', model: 'qwen3.5:9b', residency: 'local' }),
      expect.objectContaining({ provider: 'ollama', model: 'ornith-1.5:9b', residency: 'local' }),
      expect.objectContaining({ provider: 'omniroute', model: 'auto', residency: 'external' }),
      expect.objectContaining({ provider: 'google', model: 'gemini-3.6-flash', residency: 'external' }),
      expect.objectContaining({ provider: 'openai', model: 'gpt-5.6-terra', residency: 'external' }),
    ]))
    const prices = rows.find(row => row.id === 'session-stats')?.config?.prices as unknown[]
    expect(prices).toContainEqual({
      provider: 'ollama', model: 'qwen3.5:9b',
      inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    })
    expect(prices).toContainEqual({
      provider: 'ollama', model: 'ornith-1.5:9b',
      inputUsdPerMillion: 0, outputUsdPerMillion: 0,
    })
    expect(prices).toContainEqual({
      provider: 'google', model: 'gemini-3.6-flash',
      inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75,
      cacheReadUsdPerMillion: 0.075,
    })
    expect(prices).toContainEqual({
      provider: 'openai', model: 'gpt-5.6-terra',
      inputUsdPerMillion: 2, outputUsdPerMillion: 12,
      cacheReadUsdPerMillion: 0.2,
    })
  })

  it('mounts dist serving, prompt section, bash variables, and publishes the URL with the LAN snapshot', async () => {
    stageDist()
    const ctx = new Context()
    // Editor markers and a project .env SSH value do not establish a remote launch.
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { VSCODE_IPC_HOOK_CLI: '/tmp/local-vscode-ipc' } },
      { source: 'project-env', path: '/work/.env', values: { SSH_CONNECTION: 'stale-project-value' } },
    ]))
    const { server, seat } = fakeHttpServer('0.0.0.0')
    ctx.provide('webServer', server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    provideLoader(ctx)
    const lifecycle: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((message) => { lifecycle.push(String(message)) })
    const openBrowser = vi.fn(async (url: string) => { lifecycle.push(`open:${url}`) })
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: ['lab.internal'] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    // Settle the injected registrations.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seat()).toBeDefined() // frontend-static claimed the fallback
    expect(ctx.get('webRuntime')).toEqual({
      lanAddresses: ['192.168.1.5'],
      trustedHosts: ['192.168.1.5', 'lab.internal'],
    })
    expect(log).toHaveBeenCalledWith('dsh web: http://127.0.0.1:4567 (LAN: http://192.168.1.5:4567)')
    expect(log).toHaveBeenCalledWith('dsh web: opening the default browser; pass --no-open to disable')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4567')
    expect(lifecycle).toEqual([
      'dsh web: http://127.0.0.1:4567 (LAN: http://192.168.1.5:4567)',
      'dsh web: opening the default browser; pass --no-open to disable',
      'open:http://127.0.0.1:4567',
    ])
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text).toContain('DeepSeek Harness implementation checkout')
    expect(assembly.sections.find(entry => entry.name === 'app:web-surface')?.text).toContain('Leon Web GUI')
    const section = assembly.sections.find(entry => entry.name === 'app:web-surface')
    expect(section?.text).toContain('http://127.0.0.1:4567')
    // The single update contract: the receiver is always on; no-refresh
    // reloads additionally need the rebuild watcher.
    expect(section?.text).toContain('pnpm run dev:web')
    const webRuntime = contributions.find(contribution => contribution.name === 'web-runtime')
    expect(Object.keys(webRuntime?.variables ?? {}).sort()).toEqual([
      'DSH_NODE', 'DSH_PLAYWRIGHT_CLI', 'DSH_WEB_URL',
    ])
    const resolvedRuntime = webRuntime?.resolve()
    expect(resolvedRuntime?.DSH_NODE).toBe(process.execPath)
    expect(resolvedRuntime?.DSH_PLAYWRIGHT_CLI).toMatch(/[\\/]@playwright[\\/]cli[\\/]playwright-cli\.js$/u)
    expect(resolvedRuntime?.DSH_WEB_URL).toBe('http://127.0.0.1:4567')
    await ctx.fiber.dispose()
  })

  it('publishes no readiness side effect when printing and browser opening are disabled', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'app:web-surface')?.text)
      .toContain('rebuilding the affected Web artifacts')
    await ctx.fiber.dispose()
  })

  it('skips the surface context when disabled (the one-shot layer): no prompt section, no bash variables', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:web-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    expect(contributions).toEqual([])
    await ctx.fiber.dispose()
  })

  it('prints the loopback-only URL line when no LAN snapshot exists', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ openBrowser: false, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('dsh web: http://127.0.0.1:4567')
    await ctx.fiber.dispose()
  })

  it.each([
    ['SSH_CONNECTION', '10.0.0.2 55000 10.0.0.9 22'],
    ['SSH_TTY', '/dev/pts/3'],
  ] as const)('prints the host URL but skips browser handoff when %s marks an SSH launch', async (name, value) => {
    vi.stubEnv(name, value)
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser
    apply(ctx, new Config({ openBrowser: true, printUrl: true, surfaceContext: false, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('dsh web: http://127.0.0.1:4567')
    expect(openBrowser).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('defers readiness publication until Loader settlement and drops it on failure or teardown', async () => {
    stageDist()
    const openBrowser = vi.fn(async () => {})
    internals.openBrowser = openBrowser
    // Settlement path: both actions wait for loader.await() so their consumers
    // can request the complete app immediately.
    const settled = new Context()
    settled.provide('webServer', fakeHttpServer().server)
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    provideLoader(settled, () => settlement)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(settled, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('dsh web: http://127.0.0.1:4567')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4567')
    await settled.fiber.dispose()

    // Failed path: Loader reports the sibling failure; the app prints no URL
    // for a process that is about to exit.
    log.mockClear()
    openBrowser.mockClear()
    const failed = new Context()
    failed.provide('webServer', fakeHttpServer().server)
    provideLoader(failed, async () => { throw new Error('boot failed') })
    apply(failed, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    await failed.fiber.dispose()

    // Torn-down path: settlement resolves after the webserver is gone — no
    // line, no crash.
    log.mockClear()
    openBrowser.mockClear()
    const torn = new Context()
    const child = torn.plugin((childCtx: Context) => {
      childCtx.provide('webServer', fakeHttpServer().server)
    })
    await child
    let releaseTorn: () => void
    const tornSettlement = new Promise<void>((resolve) => { releaseTorn = resolve })
    provideLoader(torn, () => tornSettlement)
    apply(torn, new Config({ openBrowser: true, printUrl: true, surfaceContext: true, trustedHosts: [] }))
    await child.dispose() // the webServer service goes away
    releaseTorn!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
    await torn.fiber.dispose()
  })

  it('fails loud when the prompt section resolves against a portless webserver', async () => {
    stageDist()
    const ctx = new Context()
    // A webserver whose bound port is gone (torn down mid-request): the
    // section must throw, never render a URL with an undefined port.
    const { server } = fakeHttpServer()
    Object.defineProperty(server, 'port', { get: () => undefined })
    ctx.provide('webServer', server)
    apply(ctx, new Config({ openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('webServer service missing')
    await ctx.fiber.dispose()
  })

  it('resolves the real built frontend dist through the package exports, failing loud unbuilt', () => {
    // The production resolver (not the test hook). A built checkout resolves
    // the frontend package's index.html; a dist-less one (the CI coverage
    // lane runs before any build) must fail with the build hint, never a
    // silent fallback.
    try {
      expect(originalResolve()).toMatch(/dist[/\\]index\.html$/)
    } catch (error) {
      expect((error as Error).message).toContain('frontend dist not built')
    }
  })

  it.each([
    ['Error', new Error('no desktop'), 'no desktop'],
    ['non-Error', 'desktop unavailable', 'desktop unavailable'],
  ] as const)('keeps the server running and reports the manual URL when a browser failure is %s', async (_kind, failure, reason) => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    internals.openBrowser = vi.fn(async () => { throw failure })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    apply(ctx, new Config({ openBrowser: true, printUrl: false, surfaceContext: false, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('dsh web: opening the default browser; pass --no-open to disable')
    expect(diagnostic).toHaveBeenCalledWith(
      `web-app: could not open the default browser because ${reason}; visit http://127.0.0.1:4567 manually`,
    )
    expect(ctx.get('webServer')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('scrubs the helper environment and reports helper spawn or exit failures', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'must-not-reach-browser')
    vi.stubEnv('DSH_HOME', '/must-not-reach-browser')
    const completed = launcher()
    vi.mocked(spawn).mockReturnValueOnce(completed)
    const completion = originalOpenBrowser('http://127.0.0.1:4567')
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!
    expect(command).toBe(process.execPath)
    expect(args).toEqual([
      '--input-type=module',
      '--eval', expect.stringContaining('await import('),
      '--', 'http://127.0.0.1:4567',
    ])
    expect(args?.[2]).toContain("if (process.platform === 'win32')")
    expect(args?.[2]).toContain('launcher.ref()')
    expect(options?.env).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(options?.env).not.toHaveProperty('DSH_HOME')
    expect(options?.env?.PATH).toBe(process.env.PATH)
    expect(options?.stdio).toEqual(['ignore', 'inherit', 'pipe'])
    completed.emit('close', 0)
    await expect(completion).resolves.toBeUndefined()
    expect(completed.listenerCount('error')).toBe(0)

    const completedWithStderr = launcher()
    vi.mocked(spawn).mockReturnValueOnce(completedWithStderr)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const completionWithStderr = originalOpenBrowser('http://127.0.0.1:4567')
    completedWithStderr.stderr?.write('launcher note\n')
    completedWithStderr.emit('close', 0)
    await expect(completionWithStderr).resolves.toBeUndefined()
    expect(stderr).toHaveBeenCalledWith('launcher note\n')

    const failedWithReason = launcher()
    vi.mocked(spawn).mockReturnValueOnce(failedWithReason)
    const reasonFailure = originalOpenBrowser('http://127.0.0.1:4567')
    const reasonAssertion = expect(reasonFailure).rejects.toThrow('desktop unavailable')
    failedWithReason.stderr?.write('Error: desktop unavailable\n    at fixture')
    failedWithReason.emit('close', 1)
    await reasonAssertion

    const failed = launcher()
    vi.mocked(spawn).mockReturnValueOnce(failed)
    const failure = originalOpenBrowser('http://127.0.0.1:4567')
    const failureAssertion = expect(failure).rejects.toThrow('exited with code 3')
    await Promise.resolve()
    failed.emit('close', 3)
    await failureAssertion

    const errored = launcher()
    vi.mocked(spawn).mockReturnValueOnce(errored)
    const error = originalOpenBrowser('http://127.0.0.1:4567')
    const errorAssertion = expect(error).rejects.toThrow('spawn failed')
    await Promise.resolve()
    errored.emit('error', new Error('spawn failed'))
    await errorAssertion
    expect(errored.listenerCount('close')).toBe(0)
  })
})
