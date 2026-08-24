import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/leon-project-engineer/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/leon-project-engineer/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface SkillSnapshot {
  summary: { description: string; name: string; provider: string }
  result: { value: { content: string; name: string; provider: string } }
}

describe('Leon Windows assembled snapshot', () => {
  it('ships the guarded UI Automation workflow through the assembled app', async () => {
    const result = await runLoaderSmoke({
      label: 'Leon Windows skill snapshot',
      tempDirPrefix: 'headless-snapshot-leon-windows-',
      binScript,
      libBinScript: binScript,
      binArgs: [configPath, 'leon-windows'],
      configPath,
      tsconfigPath,
      processTimeoutMs: 90_000,
    })
    const snapshot = JSON.parse(result.stdout) as SkillSnapshot
    const content = snapshot.result.value.content

    expect({
      stderr: result.stderr,
      name: snapshot.result.value.name,
      provider: snapshot.result.value.provider,
      catalogDescription: snapshot.summary.description,
      exposesAccessibilityInspection: content.includes('## Interface gráfica por acessibilidade'),
      requiresExactWindowAllowlist: content.includes('-AllowWindowId "<id>"'),
      requiresExactProcessAllowlist: content.includes('-AllowProcess "notepad"'),
      retainsAuditTrail: content.includes('audit -Limit 50'),
      refusesPasswordControls: content.includes('não preenche controles marcados como senha'),
      refusesCoordinateFallback: content.includes('não troque silenciosamente para cliques por coordenadas'),
    }).toMatchInlineSnapshot(`
      {
        "catalogDescription": "Diagnosticar e operar o computador Windows com PowerShell, incluindo arquivos, processos, serviços, rede, aplicativos e ambiente local. Use quando o usuário pedir para verificar, configurar, abrir ou automatizar algo no próprio PC.",
        "exposesAccessibilityInspection": true,
        "name": "leon-windows",
        "provider": "filesystem",
        "refusesCoordinateFallback": true,
        "refusesPasswordControls": true,
        "requiresExactProcessAllowlist": true,
        "requiresExactWindowAllowlist": true,
        "retainsAuditTrail": true,
        "stderr": "",
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS + 60_000)
})
