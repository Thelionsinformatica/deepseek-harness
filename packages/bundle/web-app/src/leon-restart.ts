/** Same-origin restart-handoff route for Leon's browser GUI supervisor launch. */

import { basename, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Same-origin endpoint used only by the Leon Web settings surface. */
export const LEON_RESTART_PATH = '/api/leon/restart'

/** Deployment-owned supervisor handoff limits. */
export interface LeonRestartConfig {
  /** Absolute path to the operator-owned restart supervisor script; empty disables the route. */
  scriptPath: string
  /**
   * Executable that interprets `scriptPath`. Empty runs it through Node's
   * embedded PowerShell launcher; any other value is spawned directly with the
   * script as its only argument, which is what a `.cmd` wrapper needs.
   */
  program?: string
  /** Complete `NAME=VALUE` pairs forwarded verbatim to the supervisor process. */
  environment: string[]
}

const MAX_BODY_BYTES = 8 * 1024

/**
 * Child entry that runs the operator's PowerShell supervisor. It is spawned
 * through Node with `powershell.exe -File` so the route never embeds any
 * deployment command text, and the script path arrives only as argv. The
 * supervisor owns stop/start/verify; this process simply detaches it and lets
 * the supervisor stop the listener proven to be this app.
 */
const SUPERVISOR_PROGRAM = `
const { spawn } = require('node:child_process')
const script = process.argv[1]
const root = process.env.SystemRoot || process.env.windir || 'C:\\\\WINDOWS'
const shell = root + '\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'
const child = spawn(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
  stdio: 'ignore',
  detached: true,
  windowsHide: true,
})
child.on('error', () => { process.exitCode = 1 })
child.unref()
`

/** One bounded JSON reply; the response is closed inside every branch below. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Build the child environment from the shared scrub plus only the allowlisted pairs. */
function restartEnvironment(pairs: readonly string[]): Record<string, string> {
  const env = scrubbedParentEnv()
  for (const pair of pairs) {
    const split = pair.indexOf('=')
    if (split > 0) env[pair.slice(0, split)] = pair.slice(split + 1)
  }
  return env
}

/**
 * Register the same-origin restart handoff, or refuse to register it when no
 * supervisor script was configured. The route never restarts this process by
 * itself: it detaches the operator-owned supervisor, which stops exactly the
 * listener proven to be this app and starts a fresh one through the official
 * initializer. Detaching is what lets the handoff survive the stopped parent.
 * @param ctx - Web application context that owns the route lifecycle.
 * @param config - Deployment-owned supervisor location and forwarded variables.
 * @param trustedHosts - Same deployment-owned authorities accepted by the `/api` bridge.
 */
export function registerLeonRestart(
  ctx: Context,
  config: LeonRestartConfig,
  trustedHosts: readonly string[] = [],
): void {
  // An empty script path is the shipped default: no route exists until an
  // operator points this bundle at a reviewed supervisor.
  if (config.scriptPath === '') return
  ctx.effect(() => {
    let inFlight = false
    const unregister = ctx.webServer.register({
      kind: 'exact',
      path: LEON_RESTART_PATH,
      handler: async (req, res) => {
        // Exact routes win before the Connection package's `/api` prefix
        // route. Apply its shared origin fence here before method, body, or
        // supervisor handling so a rebound or cross-site request has no oracle.
        if (!isTrustedApiRequest(req, trustedHosts)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } })
          return
        }
        // Claim the handoff before awaiting the body: two concurrent requests
        // would otherwise both pass a check placed after the await and detach
        // two supervisors.
        if (inFlight) {
          json(res, 429, { error: { code: 'RESTART_IN_FLIGHT', message: 'A restart handoff is already running.' } })
          return
        }
        inFlight = true
        let overflow = false
        let received = 0
        try {
          for await (const chunk of req) {
            received += (chunk as Buffer).length
            if (received > MAX_BODY_BYTES) {
              overflow = true
              break
            }
          }
        } catch {
          overflow = true
        }
        if (overflow) {
          inFlight = false
          json(res, 413, { error: { code: 'BODY_TOO_LARGE', message: 'The restart request exceeded its body limit.' } })
          return
        }
        try {
          const child = spawn(
            config.program ?? process.execPath,
            config.program === undefined
              ? ['-e', SUPERVISOR_PROGRAM, config.scriptPath]
              : [config.scriptPath],
            {
              cwd: dirname(config.scriptPath),
              env: restartEnvironment(config.environment),
              stdio: 'ignore',
              detached: true,
              windowsHide: true,
            },
          )
          child.unref()
          json(res, 202, { accepted: true, supervisor: basename(config.scriptPath) })
        } catch (error: unknown) {
          // A spawn failure must answer the caller rather than leave the socket
          // hanging, and must not retry implicitly: the operator decides.
          const reason = error instanceof Error ? error.message : String(error)
          json(res, 500, { error: { code: 'SUPERVISOR_LAUNCH_FAILED', message: reason } })
        } finally {
          inFlight = false
        }
      },
    })
    return () => { unregister() }
  }, 'web-app: Leon restart handoff')
}
