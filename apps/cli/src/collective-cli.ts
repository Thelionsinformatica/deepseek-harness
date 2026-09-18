/** Explicit child-process laboratory bridge; release dependencies contain no experimental runtime. */
import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import type { CollectiveInvocation } from './args.ts'

const UNAVAILABLE = 'Leon Coletivo: execução indisponível neste comando; o runtime persistente de sessões, ferramentas e revisão ainda não está conectado. Nenhuma tarefa, teste ou memória foi executada ou gravada. Use --dry-run para inspecionar somente o plano.'

function rejectRuntime(invocation: CollectiveInvocation, message: string): number {
  if (invocation.json) {
    process.stdout.write(JSON.stringify({ status: 'unavailable', code: 'COLLECTIVE_RUNTIME_INVALID', executed: false, persisted: false, message }) + '\n')
  } else {
    process.stderr.write(`Leon Coletivo: ${message}\n`)
  }
  return 2
}

async function validatePath(value: string | undefined, kind: 'runtime' | 'config' | 'workspace'): Promise<string> {
  if (!value || !isAbsolute(value) || /^[\\/]{2}/.test(value) || /[\0\r\n]/.test(value)) {
    throw new Error(`--${kind} exige um caminho local absoluto.`)
  }
  const entry = await lstat(value)
  if (entry.isSymbolicLink() || (kind === 'workspace' ? !entry.isDirectory() : !entry.isFile())) {
    throw new Error(`--${kind} exige ${kind === 'workspace' ? 'um diretório' : 'um arquivo'} real, sem link simbólico.`)
  }
  if (kind !== 'workspace' && !(kind === 'runtime' ? ['.js', '.mjs'] : ['.yml', '.yaml']).includes(extname(value).toLowerCase())) {
    throw new Error(`--${kind} possui extensão não permitida; o runtime deve ser JavaScript compilado.`)
  }
  return value
}

async function delegateRuntime(invocation: CollectiveInvocation): Promise<number> {
  let runtime: string, config: string, workspace: string
  const action = invocation.action
  try {
    if (invocation.mission?.trim()) throw new Error('Texto de missão arbitrário não é aceito na execução do laboratório.')
    if (invocation.scenario !== 'import-idempotency') throw new Error('--scenario deve ser import-idempotency.')
    if (!action || !['run', 'resume', 'status', 'stop'].includes(action)) throw new Error('--action deve ser run, resume, status ou stop.')
    runtime = await validatePath(invocation.runtime, 'runtime')
    config = await validatePath(invocation.config, 'config')
    workspace = await validatePath(invocation.workspace, 'workspace')
  } catch (error) {
    return rejectRuntime(invocation, error instanceof Error ? error.message : String(error))
  }
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
    value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(name)))
  env.LEON_COLLECTIVE_LOCAL_TOKEN = 'local-placeholder'
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runtime, action, workspace, config], {
      cwd: workspace, env, shell: false, windowsHide: true, stdio: 'inherit',
    })
    let interrupted: number | undefined
    const interrupt = (signal: NodeJS.Signals, code: number): void => {
      if (interrupted !== undefined) return
      interrupted = code
      child.kill(signal)
    }
    const onInt = (): void => { interrupt('SIGINT', 130) }
    const onTerm = (): void => { interrupt('SIGTERM', 143) }
    process.on('SIGINT', onInt)
    process.on('SIGTERM', onTerm)
    child.once('error', (error) => { process.stderr.write(`Leon Coletivo: falha ao iniciar runtime: ${error.message}\n`) })
    child.once('close', (code, signal) => {
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
      resolve(interrupted ?? code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 2))
    })
  })
}

/**
 * Preview without side effects, or forward a trusted explicit runtime's output and exit code.
 * @param invocation Parsed collective command options.
 * @returns Zero for preview, two for invalid or unavailable runtime, otherwise the child's exit code; interruption returns 130 or 143.
 */
export function runCollective(invocation: CollectiveInvocation): Promise<number> {
  const mission = invocation.mission?.trim() || 'Auditar integridade de componentes, dependências e rotas do projeto'
  if (!invocation.dryRun && invocation.runtime !== undefined) return delegateRuntime(invocation)
  if (!invocation.dryRun) {
    if (invocation.json) {
      process.stdout.write(JSON.stringify({
        status: 'unavailable', code: 'COLLECTIVE_RUNTIME_UNAVAILABLE', executed: false,
        persisted: false, mission, message: UNAVAILABLE,
      }, null, 2) + '\n')
    } else {
      process.stderr.write(UNAVAILABLE + '\n')
    }
    return Promise.resolve(2)
  }

  const tasks = [
    { id: 'investigacao', title: 'Investigar fontes e reunir evidências', dependsOn: [] },
    { id: 'entrega', title: 'Preparar somente alterações autorizadas', dependsOn: ['investigacao'] },
    { id: 'revisao', title: 'Verificar artefatos e critérios com revisão independente', dependsOn: ['entrega'] },
  ]
  if (invocation.json) {
    process.stdout.write(JSON.stringify({
      status: 'dry-run', executed: false, persisted: false, mission,
      notice: 'Plano ilustrativo não executado; não cria sessões, agentes, permissões, testes ou evidências.',
      tasks,
    }, null, 2) + '\n')
  } else {
    process.stdout.write([
      'LEON COLETIVO — PLANO NÃO EXECUTADO',
      `Missão: ${mission}`,
      'Prévia ilustrativa; não cria sessões, agentes, permissões, testes, evidências ou memória.',
      ...tasks.map(task => `- ${task.title}`),
      'Esta prévia não executa o runtime; execução exige uma composição experimental explícita.',
      '',
    ].join('\n'))
  }
  return Promise.resolve(0)
}
