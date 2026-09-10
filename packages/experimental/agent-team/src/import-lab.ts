/** Bounded import-policy laboratory: data inspection and a host-owned deterministic verifier, not generic code execution. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from './mission-control.ts'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { TeamError } from './error.ts'

/** Loader plugin name. */
export const name = 'team-import-lab'
/** The demonstration reuses native tools, Team tasks and mission control. */
export const inject = ['agents', 'agentTeams', 'teamMissions', 'tools', 'systemPrompt']
/** Explicit authorized demonstration directory. */
export interface Config { workspace: string }
/** No cwd fallback: the host names the authorized directory. */
export const Config: schema<Config> = schema.object({ workspace: schema.string().required() })

const policySchema = z.object({ mode: z.enum(['append', 'upsert']) }).strict()
interface ImportPolicy { path: string; mode: 'append' | 'upsert'; digest: string }
interface ImportVerification {
  kind: 'test_result'
  digest: string
  mode: 'append' | 'upsert'
  passed: boolean
  count: number
  expectedCount: number
  rows: Array<{ id: string; value: number }>
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const output = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/**
 * Read only the demonstration's policy after rejecting redirected paths.
 * @param workspace - exact absolute directory approved by the host.
 * @returns parsed policy and digest of the exact bytes inspected.
 */
export async function readImportPolicy(workspace: string): Promise<ImportPolicy> {
  if (resolve(await realpath(workspace)) !== resolve(workspace)) throw new Error('Lab workspace is redirected')
  const path = join(workspace, 'import-policy.json')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid lab policy file')
  const text = await readFile(path, 'utf8')
  return { path, ...policySchema.parse(JSON.parse(text)), digest: digest(text) }
}

const WINDOWS_TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])

async function renameWithWindowsRetries(source: string, destination: string): Promise<void> {
  let delay = 20
  for (let retries = 0;; retries += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? ''
      if (process.platform !== 'win32' || !WINDOWS_TRANSIENT_RENAME_ERRORS.has(code) || retries >= 8) {
        throw error
      }
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 200)
  }
}

/**
 * Execute the same two-record import twice; upsert must preserve cardinality and updated values.
 * @param workspace - authorized fixture directory; no arbitrary source is executed.
 * @returns deterministic observed output, expected values and exact policy digest.
 */
export async function verifyImportPolicy(workspace: string): Promise<ImportVerification> {
  const policy = await readImportPolicy(workspace)
  const first = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]
  const second = [{ id: 'a', value: 3 }, { id: 'b', value: 2 }]
  const rows = [...first]
  for (const row of second) {
    const index = rows.findIndex(item => item.id === row.id)
    if (policy.mode === 'upsert' && index >= 0) rows[index] = row
    else rows.push(row)
  }
  return { kind: 'test_result', digest: policy.digest, mode: policy.mode,
    passed: rows.length === 2 && rows[0]?.value === 3, count: rows.length, expectedCount: 2, rows }
}

/**
 * Verify native collaborative work and the current fixture, not a model's success claim.
 * @param ctx - runtime owning the canonical Team journal.
 * @param lead - current authorized root.
 * @param workspace - authorized fixture directory.
 * @returns completion decision with current evidence summary.
 */
export async function verifyImportMission(ctx: Context, lead: Agent, workspace: string): Promise<{ passed: boolean; summary: string }> {
  const test = await verifyImportPolicy(workspace)
  const members = ctx.agentTeams.listMembers(lead).filter(member => member.role === 'teammate')
  const tasks = ctx.agentTeams.listTasks(lead)
  let peerMessage = false
  let workerVerification = false
  for (const member of members) {
    const events = ctx.agents.get(member.id)?.session.events
      ?? (await ctx.sessionPersistence.load(member.id)).events
    const receipts = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'team-message'
      && lead.session.events.some(queued => queued.type === 'team/message/queued'
        && queued.data.message.senderId !== lead.id && queued.data.message.targetId === member.id
        && event.data.source.kind === 'team-message' && queued.data.message.id === event.data.source.messageId))
    const calls = new Set(events.flatMap(event => event.type === 'tool/call' && event.data.name === 'mission_verify'
      && receipts.some(receipt => receipt.seq < event.seq) ? [event.data.callId] : []))
    if (receipts.length > 0 && calls.size > 0) peerMessage = true
    if (events.some(event => event.type === 'tool/result'
      && event.data.message.content.some(block => !block.isError && calls.has(block.toolCallId)
        && block.content.some((item) => {
          if (item.type !== 'text') return false
          try {
            const proof = z.object({ kind: z.literal('test_result'), passed: z.literal(true), digest: z.string() }).safeParse(JSON.parse(item.text))
            return proof.success && proof.data.digest === test.digest
          } catch { return false }
        })))) workerVerification = true
  }
  const passed = test.passed && members.length === 2 && tasks.length >= 2
    && tasks.every(task => task.status === 'completed') && peerMessage && workerVerification
  return { passed, summary: JSON.stringify({ test, members: members.map(member => member.name),
    tasks: tasks.map(task => ({ id: task.id, status: task.status })), peerMessage, workerVerification }) }
}

/**
 * Mount bounded tools; no shell, arbitrary file path, network or memory promotion is exposed.
 * @param ctx - isolated runtime.
 * @param config - authorized demonstration directory.
 */
export function apply(ctx: Context, config: Config): void {
  const taskOperations = new Map<string, Promise<unknown>>()
  ctx.effect(() => ctx.systemPrompt.context({ name: 'collective-lab-role', order: 90, text: () => {
    const agent = ctx.agents.requireInitiator()
    const member = ctx.agentTeams.membership(agent)
    const tasks = ctx.agentTeams.listTasks(agent)
    const roster = ctx.agentTeams.listMembers(agent).map(item => item.name)
    return `Identidade operacional: ${member.name}. Papel: ${member.role}. Destinos existentes: ${roster.join(', ')}.
Quadro autoritativo atual: ${JSON.stringify(tasks)}.
Trabalhadores usam mission_task phase=start uma vez e phase=complete após registrar evidência. O quadro nativo gerencia id e revisão. Não crie outras tarefas.
${member.role === 'lead'
  ? 'Você é o único editor. Corrija com mission_patch upsert e digest observado. Desperte checker para verificação final. Não assuma nem crie tarefas adicionais para os trabalhadores.'
  : 'Você NÃO é o coordenador, NÃO edite e NÃO use wait_agent. Execute sua investigação, comunique e termine o turno. Use followup_task para entregar descoberta a um colega inativo. Destino do coordenador: lead. Se já concluiu sua tarefa, não crie outra; execute apenas a verificação pedida.'}`
  } }))
  const caller = (agent: Agent | undefined) => {
    if (agent === undefined) throw new TeamError('Missing caller', 'TEAM_NOT_MEMBER')
    const member = ctx.agentTeams.membership(agent)
    const record = ctx.teamMissions.get(member.root)
    if (record.state !== 'running' || record.workspace !== config.workspace || Date.now() >= record.deadline) {
      throw new TeamError('Lab action not authorized', 'MISSION_NOT_RUNNING')
    }
    return member
  }
  const taskTool = defineTool({
    name: 'mission_task', description: 'Worker only: start or submit your own native Team task. The host resolves its current revision; completion still requires evidence.',
    parameters: { phase: { type: 'string', enum: ['start', 'complete'], required: true } }, output,
    async execute(args, exec) {
      const member = caller(exec.agent)
      if (member.role !== 'teammate' || exec.agent === undefined) throw new TeamError('Worker task only', 'MISSION_WORKER_REQUIRED')
      const agent = exec.agent
      const previous = taskOperations.get(member.name) ?? Promise.resolve()
      const operation = previous.catch(() => {}).then(async () => {
        caller(agent)
        exec.signal.throwIfAborted()
        const subject = `LC: ${member.name}`
        let task = ctx.agentTeams.listTasks(agent).find(item => item.subject === subject)
        ?? await ctx.agentTeams.createTask(agent, { subject, description: 'Investigate import and submit current tool evidence' })
        if (task.status === 'pending') task = await ctx.agentTeams.updateTask(agent,
          { taskId: task.id, expectedRevision: task.revision, action: 'claim' })
        if (args.phase === 'complete' && task.status !== 'completed') task = await ctx.agentTeams.updateTask(agent,
          { taskId: task.id, expectedRevision: task.revision, action: 'complete' })
        return { id: task.id, revision: task.revision, status: task.status, owner: task.ownerName ?? null }
      })
      taskOperations.set(member.name, operation)
      try { return await operation } finally {
        if (taskOperations.get(member.name) === operation) taskOperations.delete(member.name)
      }
    },
  })
  ctx.effect(() => ctx.tools.register(taskTool))
  ctx.effect(() => ctx.tools.register({ ...taskTool, name: 'mission_task_complete' }))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mission_inspect', description: 'Read the authorized import policy and dataset facts. No duplicate source file exists.',
    parameters: {}, output,
    async execute(_args, exec) {
      caller(exec.agent)
      exec.signal.throwIfAborted()
      const policy = await readImportPolicy(config.workspace)
      return { kind: 'observation', digest: policy.digest, mode: policy.mode,
        sourceFiles: ['import-policy.json'], uniqueSourceIds: ['a', 'b'], sourceHasDuplicates: false }
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mission_verify', description: 'Run the approved repeat-import verifier; returns actual row count, expected count and policy digest.',
    parameters: {}, output,
    async execute(_args, exec) {
      caller(exec.agent)
      exec.signal.throwIfAborted()
      return { ...await verifyImportPolicy(config.workspace) }
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mission_patch', description: 'Lead only: change the import policy using the digest you inspected. Workers cannot write.',
    parameters: { expected_digest: { type: 'string', required: true }, mode: { type: 'string', enum: ['append', 'upsert'], required: true } },
    output,
    async execute(args, exec) {
      const member = caller(exec.agent)
      if (member.role !== 'lead') throw new TeamError('Only Lead may change the workspace', 'MISSION_WRITE_DENIED')
      const current = await readImportPolicy(config.workspace)
      if (current.digest !== args.expected_digest) throw new TeamError('Policy changed; inspect again', 'MISSION_STALE_ARTIFACT')
      caller(exec.agent)
      exec.signal.throwIfAborted()
      const staged = join(config.workspace, `.policy-${randomUUID()}.tmp`)
      const handle = await open(staged, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({ mode: args.mode })}\n`)
        await handle.sync()
      } finally { await handle.close() }
      try {
        caller(exec.agent)
        exec.signal.throwIfAborted()
        if ((await readImportPolicy(config.workspace)).digest !== current.digest) {
          throw new TeamError('Policy changed before commit', 'MISSION_STALE_ARTIFACT')
        }
        await renameWithWindowsRetries(staged, current.path)
      } finally { await unlink(staged).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }) }
      return { kind: 'decision', ...(await readImportPolicy(config.workspace)) }
    },
  })))
  ctx.effect(() => ctx.agentTeams.registerCompletionReviewer(async (agent) => {
    const current = await readImportPolicy(config.workspace)
    const calls = new Set(agent.session.events.flatMap(event => event.type === 'tool/call'
      && (event.data.name === 'mission_inspect' || event.data.name === 'mission_verify') ? [event.data.callId] : []))
    const evidence = agent.session.events.some(event => event.type === 'tool/result'
      && event.data.message.content.some(block => !block.isError && calls.has(block.toolCallId)
        && block.content.some(item => item.type === 'text' && item.text.includes(current.digest))))
    return evidence
  }))
}
