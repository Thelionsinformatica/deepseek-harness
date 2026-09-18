#!/usr/bin/env node
/** Explicit isolated laboratory runner; stdout reports observed state and stdin accepts host controls. */
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import { mkdir, open, readdir, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { verifyImportMission } from './import-lab.ts'
import { runHostImport } from './host-import-run.ts'
import type {} from './mission-control.ts'
import { TeamError } from './error.ts'

const [command, directory, configPath] = process.argv.slice(2)
if (!['run', 'resume', 'status', 'stop'].includes(command ?? '') || directory === undefined || (!isAbsolute(directory) && directory !== '--cwd')
  || configPath === undefined || !isAbsolute(configPath)) {
  throw new Error('Usage: lab-bin <run|resume|status|stop> <absolute empty lab directory> <absolute collective config>')
}
const workspace = directory === '--cwd' ? process.cwd() : resolve(directory)
await mkdir(workspace, { recursive: true })
if (command === 'run' && (await readdir(workspace)).length !== 0) throw new Error('New mission requires an empty laboratory directory')
const lockPath = join(workspace, '.owner.lock')
const lock = await open(lockPath, 'wx', 0o600)
await lock.writeFile(JSON.stringify({ pid: process.pid, workspace }))
let ctx: Awaited<ReturnType<typeof boot>> | undefined
let input: ReturnType<typeof createInterface> | undefined
try {
  process.chdir(workspace)
  process.env.DSH_HOME = join(workspace, 'home')
  process.env.DSH_AGENTS_HOME = join(workspace, 'agents')
  // The unauthenticated local server accepts this placeholder; no ambient credential is used.
  process.env.LEON_COLLECTIVE_LOCAL_TOKEN = 'local-llamacpp-no-credential'
  if (command === 'run') await writeFile(join(workspace, 'import-policy.json'), '{"mode":"append"}\n', { flag: 'wx' })
  ctx = await boot('leon-collective-lab', configPath)
  const runtime = ctx
  const id = SessionId('leon-collective')
  if (command === 'status' || command === 'stop') {
    const state = command === 'status' ? ctx.teamMissions.inspectStored(id) : await ctx.teamMissions.stopStored(id)
    process.stdout.write(`${JSON.stringify(state)}\n`)
  } else {
    if (command === 'resume') {
      const stored = ctx.teamMissions.inspectStored(id)
      if (stored.state !== 'paused') throw new TeamError('Only a paused mission can resume', 'MISSION_INVALID_TRANSITION')
      if (Date.now() >= stored.deadline) throw new TeamError('Original mission deadline expired', 'MISSION_DEADLINE')
      if (ctx.teamMissions.requiresComposition && stored.composition?.state !== 'ready') {
        throw new TeamError('Interrupted composition requires inspection, not respawn', 'MISSION_COMPOSITION_INCOMPLETE')
      }
    }
    let driving = command === 'run'
    // Native resume can wake persisted inbox work. Control-only commands must never infer.
    ctx.on('agent/pre-step', async (_payload, next) => {
      if (!driving) throw new TeamError('Host control command does not authorize inference', 'MISSION_HOST_CONTROL')
      return next()
    })
    const options = { provider: 'collective-local', model: 'qwen3.5:4b', maxTokens: 2048 }
    const lead = command === 'run'
      ? ctx.agentLoop.create(id, options, { cwd: workspace })
      : (await ctx.agentLoop.resume(ctx, { resumeSessionId: id, agentOptions: options })).agent
    if (command === 'run') await ctx.teamMissions.start(lead, 'Corrigir duplicação na importação repetida com dois trabalhadores',
      'Duas sessões de trabalhadores, tarefas verificadas, comunicação entre colegas e importação idempotente com valores atualizados')
    if (command === 'resume') {
      const state = ctx.teamMissions.get(lead)
      await ctx.teamMissions.transition(lead, state.revision, 'resume')
      driving = true
    }
    ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end') {
        process.stdout.write(`${JSON.stringify({ session: session.id, event })}\n`)
      }
    })
    let controls = Promise.resolve()
    const control = (action: string) => {
      controls = controls.then(async () => {
        const state = runtime.teamMissions.get(lead)
        if (action === 'status') process.stdout.write(`${JSON.stringify(state)}\n`)
        else if (action === 'pause' || action === 'stop') {
          let observed = state
          // Only concurrent reservations may retry; terminal state and resume retain their checks.
          for (let remaining = state.maxCalls - state.calls + 1; remaining > 0; remaining--) {
            try {
              const committed = await runtime.teamMissions.transition(lead, observed.revision, action)
              process.stdout.write(`${JSON.stringify({ control: action, mission: committed })}\n`)
              break
            } catch (error) {
              if (action !== 'pause' || !(error instanceof TeamError)
                || error.code !== 'MISSION_STALE_REVISION' || remaining === 1) throw error
              observed = runtime.teamMissions.get(lead)
              if (observed.state !== 'running') throw error
            }
          }
        }
      }).catch((error: unknown) => { process.stderr.write(`${String(error)}\n`) })
    }
    input = createInterface({ input: process.stdin })
    input.on('line', control)
    const interrupt = () => { control('stop') }
    process.on('SIGINT', interrupt)
    try {
      if (ctx.teamMissions.requiresComposition) {
        await runHostImport(ctx, lead, workspace)
      } else {
        lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
        'Missão coletiva autorizada. Você é lead. Crie checker primeiro e researcher depois, com tarefas próprias. Researcher deve mission_inspect e followup_task checker com descoberta e digest; checker deve mission_verify e enviar resultado a lead. Apenas lead aplica mission_patch mode=upsert com digest observado. Depois desperte checker para mission_verify atualizado e conclusão da tarefa. Compartilhem descoberta entre colegas. Complete as duas tarefas com evidência. Não use nuvem.' }] }))
        for (let review = 0; review <= 2; review++) {
        // A Lead turn ending is not the end of the mission: peers may still be generating.
          await lead.whenIdle()
          await Promise.all(ctx.agentTeams.listMembers(lead).map(async (member) => { await runtime.agents.get(member.id)?.whenIdle() }))
          await lead.whenIdle()
          const current = ctx.teamMissions.get(lead)
          if (current.state !== 'running' || current.calls >= current.maxCalls || review === 2) break
          const proof = await verifyImportMission(runtime, lead, workspace)
          if (proof.passed) break
          if (ctx.agentTeams.listMembers(lead).some(member => member.name === 'researcher')) {
            await ctx.agentTeams.sendMessage(lead, { target: 'researcher', delivery: 'wakeup',
              signal: AbortSignal.timeout(Math.max(1, current.deadline - Date.now())),
              content: [{ type: 'text', text: 'Solicitação do verificador: execute mission_inspect e compartilhe a evidência DIRETAMENTE com checker usando followup_task target=checker. Na mensagem peça que checker execute mission_verify usando essa descoberta. Não envie apenas ao lead. Depois use mission_task phase=complete para registrar sua entrega.' }] })
            await Promise.all(ctx.agentTeams.listMembers(lead).map(async (member) => { await runtime.agents.get(member.id)?.whenIdle() }))
          }
          if (ctx.agentTeams.listMembers(lead).some(member => member.name === 'checker')) {
          // The host reviewer requests measurement, never fabricates it or completes a task.
            await ctx.agentTeams.sendMessage(lead, { target: 'checker', delivery: 'wakeup',
              signal: AbortSignal.timeout(Math.max(1, current.deadline - Date.now())),
              content: [{ type: 'text', text: 'Solicitação do verificador do laboratório: releia a descoberta recebida do researcher e execute mission_verify AGORA na política atual. Registre o resultado com a ferramenta; uma afirmação em texto não serve. Não crie outra tarefa. Complete sua tarefa existente se houver evidência e informe lead.' }] })
            await Promise.all(ctx.agentTeams.listMembers(lead).map(async (member) => { await runtime.agents.get(member.id)?.whenIdle() }))
            if ((await verifyImportMission(runtime, lead, workspace)).passed) break
          }
          lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
          `Verificação automática do laboratório ainda reprovada: ${proof.summary}. Continue a missão existente, sem criar novos membros. Corrija a política se necessário e solicite verificação ao trabalhador. O orçamento original não mudou.` }] }))
        }
      }
      await controls
      const state = ctx.teamMissions.get(lead)
      if (state.state === 'running') {
        const result = await ctx.teamMissions.finish(lead, () => verifyImportMission(runtime, lead, workspace))
        process.stdout.write(`${JSON.stringify({ mission: result })}\n`)
        if (result.state !== 'completed') process.exitCode = 2
      } else {
        process.stdout.write(`${JSON.stringify({ mission: state })}\n`)
        if (state.state !== 'completed') process.exitCode = 2
      }
    } catch (error: unknown) {
      const current = runtime.teamMissions.get(lead)
      if (current.state === 'running') await runtime.teamMissions.transition(lead, current.revision, 'pause')
      process.stdout.write(`${JSON.stringify({ mission: runtime.teamMissions.get(lead),
        interruption: { kind: error instanceof TeamError ? 'admission' : 'infrastructure',
          code: error instanceof TeamError ? error.code : 'HOST_EXECUTION_ERROR' } })}\n`)
      process.exitCode = 2
    } finally { process.off('SIGINT', interrupt) }
    await ctx.sessions.flush(lead.session)
  }
} finally {
  input?.close()
  await ctx?.fiber.dispose()
  await lock.close()
  await unlink(lockPath)
}
