/** Pure desktop-shell policy used by the Electron main process and tests. */

/** Default BrowserWindow dimensions for the Leon desktop shell. */
export const DESKTOP_WINDOW = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 640,
} as const

/** Whether a navigation target stays inside the host owned by the desktop shell. */
export function isLocalNavigation(target: string, origin: string): boolean {
  try {
    return new URL(target).origin === origin
  } catch {
    return false
  }
}

/** Whether this process should register itself to start with the Windows user session. */
export function shouldRegisterWindowsAutoStart(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  return platform === 'win32' && isPackaged
}
