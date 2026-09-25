#!/usr/bin/env node
/** Keyless real-Loader journey: confirmed profile, same-turn correction, forget, and persisted replay. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PersonalMemoryOwnerId } from '@deepseek-ai/dsh-personal-memory'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl'

const original = 'O nome de trabalho do usuário é Pessoa Exemplo.'
const corrected = 'O nome de trabalho do usuário é Pessoa Revisada.'
const unconfirmed = 'O usuário sem confirmação trabalha com astronomia.'
const otherOwner = 'Outro proprietário prefere documentação detalhada.'

class ProfileFixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const request = this.requests.length
    assert.ok(request <= 5, 'The fixture must use exactly five scripted model requests.')
    if (request === 1 || request === 3) {
      const name = request === 1 ? 'fixture_confirm_correction' : 'fixture_confirm_forget'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`fixture-${request}`), name, arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Consulta concluída.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function profileMessages(messages: readonly Message[]): string[] {
  return messages.flatMap(message => message.role === 'user' && message.source.kind === 'plugin'
    && message.source.plugin === 'tool-memory'
    ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
}

async function run(ctx: Context) {
  const scope = { ownerId: PersonalMemoryOwnerId('fixture-owner') }
  const sessionId = SessionId('personal-core-profile')
  const source = { kind: 'session' as const, sessionId }
  let record = await ctx.personalMemory.create({
    scope, source, content: original, core: true, validation: 'explicit', confidence: 1,
  })
  await ctx.personalMemory.create({ scope, source, content: unconfirmed, core: true })
  await ctx.personalMemory.create({
    scope: { ownerId: PersonalMemoryOwnerId('other-fixture-owner') }, source,
    content: otherOwner, core: true, validation: 'explicit', confidence: 1,
  })
  ctx.tools.register(defineContentToolFixture({
    name: 'fixture_confirm_correction', description: 'Apply the fixture human-confirmed correction.', parameters: {},
    async execute() {
      record = await ctx.personalMemory.update({
        scope, ref: { id: record.id, revision: record.revision }, content: corrected,
        validation: 'explicit', confidence: 1,
      })
      return [{ type: 'text', text: 'Fixture correction committed.' }]
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'fixture_confirm_forget', description: 'Apply the fixture human-confirmed removal.', parameters: {},
    async execute() {
      await ctx.personalMemory.forget({ scope, ref: { id: record.id, revision: record.revision } })
      return [{ type: 'text', text: 'Fixture removal committed.' }]
    },
  }))
  const adapter = new ProfileFixtureAdapter()
  ctx.llm.registerAdapter(['profile-fixture'], adapter)
  const agent = ctx.agentLoop.create(sessionId, { provider: 'profile-fixture', model: 'deterministic' })
  for (let turn = 0; turn < 3; turn += 1) {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'oi' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const end = agent.session.events.at(-1)
    assert.ok(end?.type === 'turn/end' && end.data.reason.kind !== 'error', 'The fixture turn must finish successfully.')
  }
  assert.equal(adapter.requests.length, 5)
  const contexts = adapter.requests.map(request => profileMessages(request.messages))
  assert.ok(contexts[0]?.join('\n').includes(original), 'A greeting must include the confirmed profile.')
  for (const index of [1, 2]) {
    assert.ok(contexts[index]?.join('\n').includes(corrected), 'The next step and turn must include the correction.')
    assert.ok(!JSON.stringify(adapter.requests[index]?.messages).includes(original), 'Old injected values must leave model context.')
  }
  for (const index of [3, 4]) {
    assert.ok(!JSON.stringify(adapter.requests[index]?.messages).includes(original), 'Forgotten original values must stay absent.')
    assert.ok(!JSON.stringify(adapter.requests[index]?.messages).includes(corrected), 'Forgotten current values must stay absent.')
  }
  assert.ok(!JSON.stringify(adapter.requests).includes(unconfirmed), 'Unconfirmed core facts must not be injected for a greeting.')
  assert.ok(!JSON.stringify(adapter.requests).includes(otherOwner), 'Other owner records must remain isolated.')
  await ctx.sessions.flush(agent.session)
  const persisted = await ctx.sessionPersistence.load(sessionId)
  const replay = Session.create(sessionId, persisted.events, persisted.meta)
  assert.deepEqual(replay.deriveMessages(), agent.session.deriveMessages())
  assert.ok(JSON.stringify(persisted.events).includes(original), 'The original injection remains in the audit log.')
  assert.ok(JSON.stringify(persisted.events).includes(corrected), 'The corrected injection remains in the audit log.')
  assert.ok(!JSON.stringify(replay.deriveMessages()).includes(corrected), 'Replay must preserve removal from active context.')
  const normalize = (text: string): string => text.replaceAll(String(record.id), '<core-memory-id>')
  return {
    requests: contexts.map((context, index) => ({ request: index + 1, personalContext: context.map(normalize) })),
    persistedPersonalMessages: persisted.events.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'tool-memory'
      ? [{ operation: event.surfaceOp === 'append' ? 'append' : 'replace', text: profileMessages([event.data]).map(normalize) }]
      : []),
    replayedPersonalContext: profileMessages(replay.deriveMessages()).map(normalize),
    activeConfirmedCoreRecords: (await ctx.personalMemory.list({ scope, statuses: ['active'], limit: 20 }))
      .items.filter(item => item.record.core === true && item.record.validation !== undefined).length,
    humanMessages: replay.deriveMessages().flatMap(message => message.role === 'user' && message.source.kind === 'user'
      ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []),
  }
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('personal-core-profile-driver: expected <config-path>')
const uninstallFailLoud = installFailLoud('personal-core-profile-driver')
let ctx: Context | undefined
try {
  ctx = await boot('personal-core-profile-driver', configPath)
  process.stdout.write(`${JSON.stringify(await run(ctx))}\n`)
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
