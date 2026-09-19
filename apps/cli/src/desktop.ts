/** Start the Web profile for a native desktop shell without opening an external browser. */

import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { ProcessShutdown } from './process-shutdown.ts'
import { runProfile } from './profile-boot.ts'

/** The loopback host used by the desktop WebView. */
const DESKTOP_HOST = '127.0.0.1'

/** Result of starting the in-process Web host for Electron. */
export interface DesktopHost {
  /** Settled Cordis root context owned by the desktop process. */
  readonly ctx: Context
  /** Graceful shutdown controller for the host tree. */
  readonly shutdown: ProcessShutdown
  /** Loopback URL served by the host. */
  readonly url: string
}

/**
 * Start the shipped Web profile on an OS-assigned loopback port.
 *
 * The host stays in the Electron main process, so native shutdown can dispose
 * the Cordis tree without killing the renderer or a child shell process.
 * @returns the settled host context, shutdown controller, and local URL.
 */
export async function startDesktopHost(): Promise<DesktopHost> {
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh-desktop'),
    profile: 'web',
    patchFiles: [],
    args: ['--no-open', '--host', DESKTOP_HOST, '--port', '0'],
  })
  const webServer = ctx.get('webServer') as { readonly port: number } | undefined
  if (webServer === undefined) {
    await shutdown.shutdown(1)
    throw new Error('dsh desktop: Web host did not expose a listening port')
  }
  return { ctx, shutdown, url: `http://${DESKTOP_HOST}:${String(webServer.port)}` }
}
