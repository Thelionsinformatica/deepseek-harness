import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

const script = fileURLToPath(new URL('../config/agent-presets/leon/skills/leon-windows/scripts/uia.ps1', import.meta.url))
const testWindow = fileURLToPath(new URL('../tests/fixtures/leon-windows-uia/test-window.ps1', import.meta.url))
const pwshPath = resolvePwshPath()

async function waitForFile(path: string) {
  for (let i = 0; i < 50; i++) {
    try { await access(path); return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
}

async function main() {
  const dshHome = await mkdtemp(join(tmpdir(), 'leon-'))
  const markerPath = join(dshHome, 'invoked.txt')
  const readyPath = join(dshHome, 'ready.txt')
  const fixture = execa(pwshPath, [
    '-NoLogo', '-NoProfile', '-STA', '-File', testWindow,
    '-MarkerPath', markerPath, '-ReadyPath', readyPath, '-Title', 'LeonTestDump'
  ], { reject: false, windowsHide: true })

  try {
    await waitForFile(readyPath)
    const listed = await execa(pwshPath, ['-File', script, 'windows', '-MaxWindows', '100'], { env: { DSH_HOME: dshHome } })
    const body = JSON.parse(listed.stdout)
    const win = body.windows.find((w: any) => w.name === 'LeonTestDump')
    if (!win) throw new Error('Janela não encontrada')

    const insp = await execa(pwshPath, ['-File', script, 'inspect', '-WindowId', win.windowId, '-Depth', '5', '-MaxNodes', '100'], { env: { DSH_HOME: dshHome } })
    console.log(JSON.stringify(JSON.parse(insp.stdout).controls, null, 2))
  } finally {
    fixture.kill()
    await fixture.catch(() => {})
    await rm(dshHome, { recursive: true, force: true })
  }
}
main().catch(console.error)