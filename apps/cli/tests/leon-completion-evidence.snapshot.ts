import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const runner = fileURLToPath(new URL('./fixtures/leon-completion-evidence/runner.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/leon-completion-evidence/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('Leon completion evidence guard through a real Loader composition', () => {
  it('retains a model-visible correction and ends on the honest replacement', async () => {
    const result = await runLoaderSmoke({
      label: 'Leon completion evidence guard snapshot',
      tempDirPrefix: 'leon-completion-evidence-snapshot-',
      binScript: runner,
      libBinScript: runner,
      binArgs: [configPath],
      configPath,
      tsconfigPath,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "assistant": [
          "Todas as ferramentas estão funcionando perfeitamente.",
          "Não executei verificações neste turno; o resultado permanece parcial.",
        ],
        "recovery": {
          "source": {
            "form": "evidence-recovery",
            "kind": "plugin",
            "plugin": "completion-claim-policy",
            "summary": "Completion evidence recovery 1/1",
          },
          "text": "A alegação global de conclusão não está sustentada pelo registro deste turno:
      - no successful tool result in the current turn
      Continue e produza/verifique as evidências faltantes, atualize as tarefas, ou responda honestamente que o resultado é parcial ou está bloqueado. Não declare que tudo está funcionando, 100% concluído ou plenamente operacional enquanto qualquer lacuna permanecer.",
        },
        "turnEnd": {
          "kind": "completed",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
