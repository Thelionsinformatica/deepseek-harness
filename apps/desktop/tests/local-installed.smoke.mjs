/** Live, keyless smoke of an unpacked or installed Leon Desktop executable. */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const playwrightPath = process.env.LEON_PLAYWRIGHT_PATH
if (!playwrightPath) throw new Error('Set LEON_PLAYWRIGHT_PATH to the existing playwright package directory.')
const { _electron } = require(playwrightPath)
const executablePath = resolve(process.argv[2])
const output = resolve(process.argv[3])
mkdirSync(output, { recursive: true })
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const results = []
for (let pass = 1; pass <= 2; pass++) {
  const desktop = await _electron.launch({ executablePath, env: environment, timeout: 30000 })
  try {
    const window = await desktop.firstWindow()
    await window.waitForURL('http://127.0.0.1:3080/', { timeout: 120000 })
    await window.getByRole('region', { name: 'Painel Leon Work', exact: true }).waitFor({ timeout: 30000 })
    await window.getByRole('tree', { name: 'Sessões', exact: true }).waitFor()
    const security = await desktop.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      const preferences = windows[0].webContents.getLastWebPreferences()
      return { windows: windows.length, sandbox: preferences.sandbox,
        nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation }
    })
    assert.equal(security.windows, 1)
    assert.equal(security.sandbox, true)
    assert.equal(security.nodeIntegration, false)
    assert.equal(security.contextIsolation, true)
    await window.screenshot({ path: join(output, `desktop-${pass}.png`) })
    if (pass === 1) {
      await new Promise((done, fail) => execFile(executablePath, [], { env: environment, timeout: 15000 }, error => error ? fail(error) : done()))
      assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    }
    results.push({ pass, title: await window.title(), url: window.url(), security, existingSessionsVisible: true })
  } finally {
    await desktop.close()
  }
  assert.equal((await fetch('http://127.0.0.1:3080/')).status, 200)
}
writeFileSync(join(output, 'smoke.json'), JSON.stringify({ executablePath, results,
  backendPreservedAfterClose: true, singleInstanceVerified: true, inferenceTested: false }, null, 2))
console.log(JSON.stringify({ passes: results.length, backendPreservedAfterClose: true, singleInstanceVerified: true }))
