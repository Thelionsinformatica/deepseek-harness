/**
 * Windows at-rest protection for the local credentials document.
 * @module @deepseek-ai/dsh-credentials-local/windows-protection
 */

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Identifier persisted beside a Windows DPAPI payload. */
export const WINDOWS_DPAPI_PROTECTION = 'windows-dpapi-current-user'

/** Binary protector used by the document codec. */
export interface CredentialProtector {
  /** Stable identifier persisted in the protected envelope. */
  readonly kind: typeof WINDOWS_DPAPI_PROTECTION
  /** Protect bytes for the current Windows user. */
  protect(plaintext: Buffer): Promise<Buffer>
  /** Recover bytes protected for the current Windows user. */
  unprotect(ciphertext: Buffer): Promise<Buffer>
}

/** Operation accepted by the fixed DPAPI helper. */
export type WindowsDpapiOperation = 'protect' | 'unprotect'

/** Injectable runner used to isolate the platform process in unit tests. */
export type WindowsDpapiRunner = (operation: WindowsDpapiOperation, input: Buffer) => Promise<Buffer>

/** DPAPI optional entropy binds this package's blobs to its versioned use. */
const DPAPI_ENTROPY = 'dsh-credentials-local/v2'
/** A local OS cryptographic call must not hold the document lock indefinitely. */
const DPAPI_TIMEOUT_MS = 10_000
/** Bound diagnostics from a failed helper without retaining their contents. */
const MAX_STDERR_BYTES = 64 * 1024

/**
 * Build the fixed PowerShell program for one DPAPI operation. Credential bytes
 * travel only over standard input and output; they never enter argv, the child
 * environment, or an error message.
 */
function dpapiScript(operation: WindowsDpapiOperation): string {
  const method = operation === 'protect' ? 'Protect' : 'Unprotect'
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$inputStream = [Console]::OpenStandardInput()',
    '$inputBuffer = New-Object System.IO.MemoryStream',
    '[void]$inputStream.CopyTo($inputBuffer)',
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
    `$result = [Security.Cryptography.ProtectedData]::${method}(`,
    '  $inputBuffer.ToArray(),',
    '  $entropy,',
    '  [Security.Cryptography.DataProtectionScope]::CurrentUser',
    ')',
    '$output = [Console]::OpenStandardOutput()',
    '$output.Write($result, 0, $result.Length)',
  ].join('\n')
}

/** Encode a fixed script for Windows PowerShell's UTF-16LE `-EncodedCommand`. */
function encodedCommand(operation: WindowsDpapiOperation): string {
  return Buffer.from(dpapiScript(operation), 'utf16le').toString('base64')
}

/** Resolve the inbox Windows PowerShell without consulting `PATH`. */
function powershellPath(): { executable: string; systemRoot: string } | Error {
  const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR']
  if (systemRoot === undefined || systemRoot.length === 0) {
    return new Error('credentials-local: Windows DPAPI is unavailable because SystemRoot is unset')
  }
  return {
    executable: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    systemRoot,
  }
}

/** Minimal environment for the trusted inbox helper; ambient credentials never cross into it. */
function powershellEnvironment(systemRoot: string): NodeJS.ProcessEnv {
  const system32 = join(systemRoot, 'System32')
  const temporary = tmpdir()
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: join(system32, 'cmd.exe'),
    PATH: `${join(system32, 'WindowsPowerShell', 'v1.0')};${system32};${systemRoot}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TEMP: temporary,
    TMP: temporary,
  }
}

/**
 * Invoke Windows DPAPI through the inbox, non-interactive Windows PowerShell.
 * The rejection never includes helper output because it could contain sensitive
 * process diagnostics; callers receive only the operation and failure class.
 * @param operation - protect or unprotect.
 * @param input - plaintext or ciphertext bytes supplied over standard input.
 * @returns the DPAPI result bytes emitted over standard output.
 */
export function runWindowsDpapi(operation: WindowsDpapiOperation, input: Buffer): Promise<Buffer> {
  const command = powershellPath()
  if (command instanceof Error) return Promise.reject(command)
  const maximumOutputBytes = Math.max(64 * 1024, input.length * 2 + 8 * 1024)
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command.executable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedCommand(operation),
    ], {
      env: powershellEnvironment(command.systemRoot),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let stderrBytes = 0
    let settled = false
    let outputOverflow = false
    let stderrOverflow = false

    const finish = (result: { error: Error } | { value: Buffer }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} timed out`) })
    }, DPAPI_TIMEOUT_MS)
    timeout.unref()

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > maximumOutputBytes) {
        outputOverflow = true
        child.kill()
        return
      }
      output.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderrOverflow = true
        child.kill()
      }
    })
    child.on('error', () => {
      finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} helper could not start`) })
    })
    child.stdin.on('error', () => {
      child.kill()
      finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} helper rejected its input`) })
    })
    child.on('close', (code) => {
      if (outputOverflow) {
        finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} returned too much data`) })
        return
      }
      if (stderrOverflow) {
        finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} produced excessive diagnostics`) })
        return
      }
      if (code !== 0) {
        finish({ error: new Error(`credentials-local: Windows DPAPI ${operation} failed with exit code ${String(code)}`) })
        return
      }
      finish({ value: Buffer.concat(output, outputBytes) })
    })
    child.stdin.end(input)
  })
}

/**
 * Create the current-user Windows DPAPI protector.
 * @param run - runner override for deterministic unit tests.
 * @returns a protector whose blobs are bound to the current Windows user.
 */
export function createWindowsDpapiProtector(run: WindowsDpapiRunner = runWindowsDpapi): CredentialProtector {
  return {
    kind: WINDOWS_DPAPI_PROTECTION,
    protect: plaintext => run('protect', plaintext),
    unprotect: ciphertext => run('unprotect', ciphertext),
  }
}

/**
 * Resolve at-rest protection for the active platform.
 * @param platform - platform override for deterministic unit tests.
 * @returns current-user DPAPI on Windows; `undefined` where owner-only POSIX permissions remain the storage control.
 */
export function credentialProtectorForPlatform(platform: NodeJS.Platform = process.platform): CredentialProtector | undefined {
  return platform === 'win32' ? createWindowsDpapiProtector() : undefined
}
