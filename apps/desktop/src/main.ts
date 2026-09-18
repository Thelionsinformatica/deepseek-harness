/** Electron main process: host the existing Leon Web profile in a native window. */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { startDesktopHost, type DesktopHost } from '@deepseek-ai/dsh/desktop'
import { DESKTOP_WINDOW, isLocalNavigation, shouldRegisterWindowsAutoStart } from './config.ts'

let desktopHost: DesktopHost | undefined
let closing = false

/** Hand supported external links to the OS without executing arbitrary schemes. */
function openExternal(url: string): void {
  try {
    const protocol = new URL(url).protocol
    if (!['http:', 'https:', 'mailto:'].includes(protocol)) return
    void shell.openExternal(url).catch(() => {})
  } catch {
    // Malformed navigation is ignored; the renderer never receives Node access.
  }
}

/** Open the local Web surface in a hardened native window. */
async function createMainWindow(): Promise<void> {
  if (desktopHost === undefined) throw new Error('dsh desktop: host is not started')
  const origin = new URL(desktopHost.url).origin
  const window = new BrowserWindow({
    width: DESKTOP_WINDOW.width,
    height: DESKTOP_WINDOW.height,
    minWidth: DESKTOP_WINDOW.minWidth,
    minHeight: DESKTOP_WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalNavigation(url, origin)) return { action: 'allow' }
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isLocalNavigation(url, origin)) return
    event.preventDefault()
    openExternal(url)
  })
  window.once('ready-to-show', () => { window.show() })
  await window.loadURL(desktopHost.url)
}

/** Dispose the host before Electron tears down the renderer. */
async function closeDesktopHost(): Promise<void> {
  if (desktopHost === undefined) return
  const host = desktopHost
  desktopHost = undefined
  await host.shutdown.shutdown(0)
}

/** Start the host and the native window after Electron has initialized. */
async function boot(): Promise<void> {
  if (process.platform === 'win32') {
    app.setAppUserModelId('br.com.thelions.leon')
    if (shouldRegisterWindowsAutoStart(process.platform, app.isPackaged)) {
      app.setLoginItemSettings({ openAtLogin: true })
    }
  }
  desktopHost = await startDesktopHost()
  await createMainWindow()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (closing) return
  event.preventDefault()
  closing = true
  void closeDesktopHost().finally(() => { app.quit() })
})

app.whenReady().then(boot).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  await closeDesktopHost()
  await dialog.showMessageBox({
    type: 'error',
    title: 'Leon não iniciou',
    message,
    buttons: ['Fechar'],
  })
  app.quit()
})
