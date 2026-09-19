/** Installed Windows shell for the existing, verified Leon deployment. */
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_WINDOW, isLocalNavigation } from './config.ts'

const origin = 'http://127.0.0.1:3080'
const deployment = process.env.LEON_ROOT || 'D:\\Leon'
let mainWindow: BrowserWindow | undefined

/** Write lifecycle evidence without recording conversations or credentials. */
function record(event: string): void {
  const folder = app.getPath('userData')
  mkdirSync(folder, { recursive: true })
  appendFileSync(join(folder, 'desktop.log'), `${new Date().toISOString()} ${event}\n`)
}

/** Flatten nested error chains into one sanitized message per cause. */
function describe(error: unknown, depth = 0): string {
  if (depth > 8 || error === undefined || error === null) return ''
  const message = error instanceof Error ? error.message : String(error)
  const children = error instanceof AggregateError ? error.errors : []
  const cause = error instanceof Error ? error.cause : undefined
  return [message, ...children.map(item => describe(item, depth + 1)), describe(cause, depth + 1)]
    .filter(part => part.length > 0)
    .join(' <= ')
}

/** Start or verify the deployment using its process-identity checks. */
async function ensureServer(): Promise<void> {
  const launcher = join(deployment, 'Iniciar-Leon.ps1')
  if (!existsSync(launcher)) throw new Error(`Inicializador ausente: ${launcher}`)
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
  environment.LEON_DESKTOP_LAUNCHER = launcher
  // PowerShell 7's inherited module path can hide Windows PowerShell's Get-FileHash.
  await new Promise<void>((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '& $env:LEON_DESKTOP_LAUNCHER -NoOpen -FreeLLMAPI:$false'], {
      env: environment,
      windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
    }, (error) => {
      if (error) reject(new Error('Não foi possível iniciar o Leon. Consulte os registros em D:\\Leon\\logs\\startup.'))
      else resolve()
    })
  })
  record('local-server-verified')
}

/** Ask before handing an external address to the browser. */
async function openLink(url: string): Promise<void> {
  let target: URL
  try { target = new URL(url) } catch { return }
  if (!['https:', 'http:', 'mailto:'].includes(target.protocol)) return
  const choice = await dialog.showMessageBox({ type: 'question', title: 'Abrir link externo',
    message: 'Abrir este endereço no aplicativo padrão?', detail: url,
    buttons: ['Cancelar', 'Abrir'], defaultId: 0, cancelId: 0 })
  if (choice.response === 1) await shell.openExternal(url)
}

/** Present a visible loading state while the local services become ready. */
async function boot(): Promise<void> {
  app.setAppUserModelId('br.com.thelions.leon.local')
  mainWindow = new BrowserWindow({ ...DESKTOP_WINDOW, title: 'Leon Desktop',
    backgroundColor: '#111318', autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalNavigation(url, origin)) void mainWindow?.loadURL(url)
    else void openLink(url).catch(() => { record('external-link-failed') })
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalNavigation(url, origin)) return
    event.preventDefault()
    void openLink(url).catch(() => { record('external-link-failed') })
  })
  mainWindow.webContents.on('render-process-gone', () => { record('renderer-exited') })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Leon', submenu: [
      { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      { label: 'Abrir registros', click: () => { void shell.openPath(join(deployment, 'logs', 'startup')) } },
      { type: 'separator' }, { role: 'quit', label: 'Fechar Leon Desktop' },
    ] },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Exibir', submenu: [{ role: 'resetZoom', label: 'Tamanho original' }, { role: 'zoomIn', label: 'Aumentar' },
      { role: 'zoomOut', label: 'Diminuir' }, { role: 'togglefullscreen', label: 'Tela cheia', accelerator: 'F11' }] },
  ]))
  await mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Leon Desktop</title><body style="background:#111318;color:#eee;font:20px Segoe UI;display:grid;place-content:center;height:90vh"><h1>LEON</h1><p>Iniciando seu ambiente…</p></body>'))
  await ensureServer()
  if (mainWindow.isDestroyed()) return
  await mainWindow.loadURL(origin)
  record('window-loaded')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.on('window-all-closed', () => { app.quit() })
  app.whenReady().then(boot).catch(async (error: unknown) => {
    const message = describe(error) || 'Falha ao abrir Leon.'
    record(`startup-failed ${message}`)
    await dialog.showMessageBox({ type: 'error', title: 'Leon não iniciou',
      message, buttons: ['Fechar'] })
    app.quit()
  })
}
