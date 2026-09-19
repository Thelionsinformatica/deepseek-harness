import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))

// This suite pins the source-launch path; the built-entry suite separately covers release artifacts.
describe('collective CLI source command without an execution runtime', () => {
  for (const args of [[], ['--json'], ['--dry-run'], ['--dry-run', '--json']]) {
    it(`does not create tasks or change persisted data for ${args.join(' ') || 'run'}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'leon-collective-preview-'))
      const history = join(dir, 'coordinator-evolution.jsonl')
      const original = '{"historical":"preserve","outcome":"completed"}\n'
      try {
        await writeFile(history, original)
        const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
          value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(name)))
        const result = await execa(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'collective', ...args, 'inspecionar módulo'], {
          cwd: root, env: { ...env, DSH_HOME: dir }, extendEnv: false, input: '', timeout: 25_000,
          killSignal: 'SIGKILL', reject: false,
        })
        expect(result.timedOut).toBe(false)
        expect(result.exitCode).toBe(args.includes('--dry-run') ? 0 : 2)
        if (args.includes('--json')) {
          expect(result.stderr).toBe('')
          expect(JSON.parse(result.stdout)).toMatchObject({
            status: args.includes('--dry-run') ? 'dry-run' : 'unavailable', executed: false, persisted: false,
          })
        } else if (args.includes('--dry-run')) {
          expect(result.stdout).toContain('PLANO NÃO EXECUTADO')
          expect(result.stderr).toBe('')
        } else {
          expect(result.stdout).toBe('')
          expect(result.stderr).toBe('Leon Coletivo: execução indisponível neste comando; o runtime persistente de sessões, ferramentas e revisão ainda não está conectado. Nenhuma tarefa, teste ou memória foi executada ou gravada. Use --dry-run para inspecionar somente o plano.')
        }
        expect(await readFile(history, 'utf8')).toBe(original)
        expect(await readdir(dir)).toEqual(['coordinator-evolution.jsonl'])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 30_000)
  }
})
