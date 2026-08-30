import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('completion evidence snapshot requires an overlay path')

const rootConfigPath = fileURLToPath(new URL(
  '../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml',
  import.meta.url,
))
const basePatchPath = fileURLToPath(new URL(
  '../../../../../packages/bundle/base/cordis.patch.yml',
  import.meta.url,
))
const ctx = await boot('completion-evidence-snapshot', rootConfigPath, [
  ...loadOverlayPatches('completion-evidence-snapshot', basePatchPath),
  ...loadOverlayPatches('completion-evidence-snapshot', overlayPath),
])

try {
  const adapter = new MockAdapter([
    textResponse('Todas as ferramentas estão funcionando perfeitamente.'),
    textResponse('Não executei verificações neste turno; o resultado permanece parcial.'),
  ])
  ctx.llm.registerAdapter(['completion-evidence-fixture'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId('completion-evidence-snapshot'),
    agentOptions: { provider: 'completion-evidence-fixture', model: 'mock' },
  })
  try {
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent, status }) => {
        if (agent !== handle.agent || status !== 'idle') return
        dispose()
        resolve()
      })
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Verifique todas as capacidades.' }],
      source: { kind: 'user' },
    }))
    await idle

    const assistant = handle.agent.session.events
      .filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
      .map(event => event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n'))
    const recovery = handle.agent.session.events.find(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'completion-claim-policy',
    )
    const recoveryText = recovery?.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n') ?? null
    const finalTurn = handle.agent.session.events.findLast(event => event.type === 'turn/end')

    process.stdout.write(`${JSON.stringify({
      assistant,
      recovery: recovery === undefined ? null : {
        source: recovery.data.source,
        text: recoveryText,
      },
      turnEnd: finalTurn?.data.reason ?? null,
    })}\n`)
  } finally {
    await handle.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
