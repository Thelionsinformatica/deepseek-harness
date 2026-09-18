/** Host-directed phase handoffs; only native tools can produce evidence or complete tasks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from './mission-control.ts'
import { readImportPolicy, verifyImportMission } from './import-lab.ts'

/** Deduplicate requests by relevant evidence state, not by counters or elapsed time. */
export class HandoffLedger {
  private readonly issued = new Set<string>()

  /**
   * Admit one request per target and evidence signature. A denial has no side effects.
   * @param target - host-bound persistent participant id.
   * @param signature - artifact, tasks and verified collaboration state, excluding token counters.
   * @returns Whether the host may issue this handoff once.
   */
  admit(target: string, signature: string): boolean {
    const key = JSON.stringify([target, signature])
    if (this.issued.has(key)) return false
    this.issued.add(key)
    return true
  }
}

/**
 * Provision two host-assigned participants and request bounded investigation, repair and review.
 * The native verifier decides completion; this function never completes a task or changes limits.
 * @param ctx - isolated laboratory runtime.
 * @param lead - live mission root with persistent state.
 * @param workspace - authorized fixture directory.
 */
export async function runHostImport(ctx: Context, lead: Agent, workspace: string): Promise<void> {
  const signal = AbortSignal.timeout(Math.max(1, ctx.teamMissions.get(lead).deadline - Date.now()))
  const composition = ctx.teamMissions.get(lead).composition?.state === 'ready'
    ? ctx.teamMissions.getComposition(lead)
    : await ctx.teamMissions.provisionTeam(lead, {
      researcher: { name: 'researcher', description: 'Investigação da importação', context: 'fresh', provider: 'spawn', signal,
        prompt: [{ type: 'text', text: 'Você é researcher, investigador. Use mission_task phase=start; mission_inspect; envie a descoberta e digest diretamente a checker com followup_task; complete sua própria tarefa com mission_task phase=complete somente após evidência. Não edite. Encerre após comunicar.' }] },
      checker: { name: 'checker', description: 'Revisão independente da importação', context: 'fresh', provider: 'spawn', signal,
        prompt: [{ type: 'text', text: 'Você é checker, revisor. Inicie sua própria tarefa com mission_task phase=start. Use mission_verify e comunique o resultado ao lead. Não conclua tarefa enquanto passed=false. Após receber descoberta do researcher e correção do lead, execute mission_verify novamente; se passed=true conclua sua tarefa. Não fique esperando com chamadas repetidas: encerre o turno enquanto aguarda mensagem.' }] },
    })
  process.stdout.write(`${JSON.stringify({ composition })}\n`)
  const settle = async () => {
    // Peer wakeups can enqueue work while another turn settles; re-read live instances.
    for (;;) {
      const agents = ctx.agents.list().filter(agent => ctx.agentTeams.tryMembership(agent)?.root === lead)
      await new Promise<void>((resolveIdle, reject) => {
        const abort = () => {
          for (const agent of agents) agent.cancel({ kind: 'hook', reason: 'Original mission deadline reached' }, { keepInbox: true })
          reject(new Error('Original mission deadline reached while waiting', { cause: signal.reason }))
        }
        signal.addEventListener('abort', abort, { once: true })
        void Promise.all(agents.map(agent => agent.whenIdle()))
          .then(() => { resolveIdle() }, reject)
          .finally(() => { signal.removeEventListener('abort', abort) })
        if (signal.aborted) abort()
      })
      if (ctx.agents.list().filter(agent => ctx.agentTeams.tryMembership(agent)?.root === lead)
        .every(agent => agent.status === 'idle')) return
      signal.throwIfAborted()
    }
  }
  lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
    'Missão autorizada: corrigir importação repetida. O host já criou researcher e checker com tarefas próprias; não crie agentes. Inspecione a política com mission_inspect, confronte evidências e aplique mission_patch upsert com digest atual quando necessário. Peça a checker verificação após a correção. Não conclua tarefas de colegas. O verificador exige duas tarefas concluídas, descoberta entregue entre colegas e teste atual aprovado. Não declare sucesso sem evidência.' }] }))
  await settle()
  const ledger = new HandoffLedger()
  for (let round = 0; round < 3; round++) {
    let issued = false
    for (const [role, target] of [['researcher', composition.researcher], ['lead', composition.lead], ['checker', composition.checker]] as const) {
      const state = ctx.teamMissions.get(lead)
      if (state.state !== 'running' || state.calls >= state.maxCalls || Date.now() >= state.deadline) return
      const proof = await verifyImportMission(ctx, lead, workspace)
      if (proof.passed) return
      const tasks = ctx.agentTeams.listTasks(lead)
      const policy = await readImportPolicy(workspace)
      const participant = ctx.agentTeams.listMembers(lead).find(member => member.id === target)
      if (participant === undefined) throw new Error('Host participant is absent from native roster')
      const latestTasks = new Map(lead.session.events.flatMap(event =>
        event.type === 'team/task' ? [[event.data.task.id, event.data.task] as const] : []))
      const task = [...latestTasks.values()].find(item => item.ownerId === target)
      // Review-only reserve is frozen for this variant. Open tasks are reported, never auto-completed.
      if (role !== 'checker' && state.calls >= state.maxCalls - 8) continue
      if (role === 'researcher' && task?.status === 'completed') continue
      if (role === 'lead' && policy.mode === 'upsert') continue
      const signature = JSON.stringify({ digest: policy.digest, proof: proof.summary, tasks })
      if (!ledger.admit(target, signature)) continue
      const content = role === 'researcher'
        ? 'Continue sua tarefa existente: registre mission_inspect, entregue descoberta e digest diretamente a checker por followup_task. Submeta sua própria tarefa com evidência. Não crie outro participante nem outra tarefa.'
        : role === 'lead'
          ? 'O artefato ainda não foi aprovado. Inspecione a política atual, use as descobertas recebidas e corrija com mission_patch e digest observado. Peça revisão ao checker. Não complete tarefas de colegas.'
          : 'Verificação final solicitada: use a descoberta recebida de researcher e execute mission_verify na política atual. Se passed=true submeta sua tarefa existente; caso contrário comunique falha e encerre. Não reutilize resultado de digest antigo.'
      process.stdout.write(`${JSON.stringify({ handoff: { role, target, digest: policy.digest, calls: state.calls,
        openTasksAtReserve: state.calls >= state.maxCalls - 8 ? tasks.filter(item => item.status !== 'completed') : [] } })}\n`)
      if (role === 'lead') {
        lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: content }] }))
      } else {
        await ctx.agentTeams.sendMessage(lead, { target: participant.name, delivery: 'wakeup', signal,
          content: [{ type: 'text', text: content }] })
      }
      issued = true
      await settle()
    }
    if (!issued) {
      process.stdout.write(`${JSON.stringify({ coordination: 'blocked', reason: 'NO_RELEVANT_STATE_CHANGE' })}\n`)
      return
    }
  }
}
