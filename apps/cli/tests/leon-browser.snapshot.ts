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

describe('Leon browser assembled snapshot', () => {
  it('ships the bounded active-page context workflow through the assembled app', async () => {
    const result = await runLoaderSmoke({
      label: 'Leon browser skill snapshot',
      tempDirPrefix: 'headless-snapshot-leon-browser-',
      binScript,
      libBinScript: binScript,
      binArgs: [configPath, 'leon-browser'],
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
      hasContextHeading: content.includes('## Contexto persistente da página'),
      inspectsOwnedSession: content.includes('inspect --session leon'),
      keepsContextLocal: content.includes('$DSH_HOME/browser-context/'),
      refusesPrivateBrowserAttachment: content.includes('não se conecta automaticamente ao navegador pessoal'),
      excludesSensitiveBrowserData: content.includes('não lê cookies, armazenamento, cabeçalhos ou corpos de requisição'),
    }).toMatchInlineSnapshot(`
      {
        "catalogDescription": "Navegar, ler, testar e interagir com sites em uma janela visível do navegador. Use quando o usuário pedir para abrir uma página, acompanhar uma tarefa no navegador, preencher um formulário, testar uma interface web ou operar um site.",
        "excludesSensitiveBrowserData": true,
        "hasContextHeading": true,
        "inspectsOwnedSession": true,
        "keepsContextLocal": true,
        "name": "leon-browser",
        "provider": "filesystem",
        "refusesPrivateBrowserAttachment": true,
        "stderr": "",
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS + 60_000)
})
