/** Keyless collaboration scenario using real tools and current policy digests. */
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
let counter = 0
function chunks(name, args) {
  const id = CallId(`collective-${++counter}`)
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
function text(value) {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }]
}
class Fixture extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx }
  async * stream(options) {
    const member = this.ctx.agentTeams.membership(this.ctx.agents.requireInitiator())
    const messages = options.messages
    const calls = messages.flatMap(message => message.role === 'assistant'
      ? message.content.filter(block => block.type === 'tool-call') : [])
    const has = name => calls.some(call => call.name === name)
    const allText = JSON.stringify(messages.filter(message => message.role === 'user'))
    const resultText = messages.flatMap(message => message.content.flatMap(block => block.type === 'tool-result'
      ? block.content.filter(item => item.type === 'text').map(item => item.text) : [])).at(-1) ?? ''
    const update = phase => calls.some(call => ['mission_task', 'mission_task_complete'].includes(call.name) && JSON.parse(call.arguments).phase === phase)
    let response
    if (member.role === 'teammate') {
      if (!update('start')) response = chunks('mission_task', { phase: 'start' })
      else if (member.name === 'researcher') {
        if (!has('mission_inspect')) response = chunks('mission_inspect', {})
        else if (!has('followup_task')) response = chunks('followup_task', { target: 'checker', message: 'NO_DUPLICATE_SOURCE: inspect repeat import instead.' })
        else if (!update('complete')) response = chunks('mission_task', { phase: 'complete' })
        else response = text('Research submitted.')
      } else if (!allText.includes('NO_DUPLICATE_SOURCE')) response = text('Awaiting researcher follow-up.')
      else if (!has('mission_verify')) response = chunks('mission_verify', {})
      else if (!has('followup_task')) response = chunks('followup_task', { target: 'lead', message: 'REPEAT_IMPORT_FAIL: choose upsert and ask me to VERIFY_AFTER_PATCH.' })
      else if (!allText.includes('VERIFY_AFTER_PATCH')) response = text('Awaiting coordinator repair.')
      else if (calls.filter(call => call.name === 'mission_verify').length < 2) response = chunks('mission_verify', {})
      else if (!update('complete')) response = chunks('mission_task_complete', { phase: 'complete' })
      else response = text('Repeat import verified.')
    } else {
      const spawned = this.ctx.teamMissions.requiresComposition
        ? this.ctx.agentTeams.listMembers(this.ctx.agents.requireInitiator()).filter(item => item.role === 'teammate').length
        : calls.filter(call => call.name === 'spawn_teammate').length
      if (spawned < 2) response = chunks('spawn_teammate', { name: spawned === 0 ? 'checker' : 'researcher',
        description: 'Bounded investigator', prompt: spawned === 0 ? 'CHECK_ROLE' : 'RESEARCH_ROLE' })
      else if (!allText.includes('REPEAT_IMPORT_FAIL')) response = chunks('wait_agent', { timeout_ms: 10000 })
      else if (!has('mission_inspect')) response = chunks('mission_inspect', {})
      else if (!has('mission_patch')) response = chunks('mission_patch', { expected_digest: JSON.parse(resultText).digest, mode: 'upsert' })
      else if (!has('followup_task')) response = chunks('followup_task', { target: 'checker', message: 'VERIFY_AFTER_PATCH' })
      else if (calls.at(-1)?.name === 'team_task_list' && (resultText.match(/"status":"completed"/gu)?.length ?? 0) === 2) {
        response = text('COLLECTIVE_VERIFIED')
      } else if (calls.at(-1)?.name === 'wait_agent') response = chunks('team_task_list', {})
      else response = chunks('wait_agent', { timeout_ms: 10000 })
    }
    yield* response
  }
}
/** Loader plugin name. */
export const name = 'collective-fixture'
/** Only the fixture adapter is replaced; all native execution owners remain real. */
export const inject = ['llm', 'agents', 'agentTeams', 'teamMissions']
/** Register a keyless route with no HTTP transport. */
export function apply(ctx) { ctx.effect(() => ctx.llm.registerAdapter(['collective-local'], new Fixture(ctx))) }
