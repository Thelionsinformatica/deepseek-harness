import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))

describe('collective command transcript', () => {
  it('reports unavailable execution and an unexecuted plan through the assembled CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leon-collective-snapshot-'))
    try {
      const outputs = []
      for (const args of [['--json'], ['--dry-run', '--json']]) {
        const launch = resolveExampleLaunch({
          srcBin: join(root, 'apps/cli/src/bin.ts'), tsconfigPath: join(root, 'tsconfig.json'),
          configArgs: ['collective', ...args, 'inspecionar módulo'],
          env: { DSH_HOME: dir },
        })
        const inherited = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
          value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(name)))
        const result = await execa(launch.command, launch.args, {
          cwd: root, env: { ...inherited, ...launch.env }, extendEnv: false,
          input: '', timeout: 25_000, killSignal: 'SIGKILL', reject: false,
        })
        expect(result.timedOut).toBe(false)
        expect(result.stderr).toBe('')
        outputs.push({ code: result.exitCode, output: JSON.parse(result.stdout) as unknown })
      }
      expect(outputs).toMatchInlineSnapshot(`
        [
          {
            "code": 2,
            "output": {
              "code": "COLLECTIVE_RUNTIME_UNAVAILABLE",
              "executed": false,
              "message": "Leon Coletivo: execução indisponível neste comando; o runtime persistente de sessões, ferramentas e revisão ainda não está conectado. Nenhuma tarefa, teste ou memória foi executada ou gravada. Use --dry-run para inspecionar somente o plano.",
              "mission": "inspecionar módulo",
              "persisted": false,
              "status": "unavailable",
            },
          },
          {
            "code": 0,
            "output": {
              "executed": false,
              "mission": "inspecionar módulo",
              "notice": "Plano ilustrativo não executado; não cria sessões, agentes, permissões, testes ou evidências.",
              "persisted": false,
              "status": "dry-run",
              "tasks": [
                {
                  "dependsOn": [],
                  "id": "investigacao",
                  "title": "Investigar fontes e reunir evidências",
                },
                {
                  "dependsOn": [
                    "investigacao",
                  ],
                  "id": "entrega",
                  "title": "Preparar somente alterações autorizadas",
                },
                {
                  "dependsOn": [
                    "entrega",
                  ],
                  "id": "revisao",
                  "title": "Verificar artefatos e critérios com revisão independente",
                },
              ],
            },
          },
        ]
      `)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
