/** Scripted model reads the real PowerShell tool results; no provider request leaves this process. */
import assert from 'node:assert/strict'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'

const commands = [
  'Write-Output before; "sha=$([System.BitConverter]::ToString(\'not-a-byte-array\'))"; Write-Output after',
  'try { [System.BitConverter]::ToString(\'not-a-byte-array\') } catch { [Console]::Out.Write("HANDLED") }',
  '[Console]::Error.Write("MethodException is diagnostic text"); [Console]::Out.Write("DIAGNOSTIC")',
  '[Console]::Error.Write("native diagnostic"); exit 7',
]

class ErrorStatusAdapter extends LlmAdapter {
  requests = 0
  transcript: Array<{ call: number; toolError: boolean; commandExit: number; output: string }> = []

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.ok(++this.requests <= 2, 'Only two scripted requests are allowed.')
    if (this.requests === 1) {
      for (const [index, command] of commands.entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id: CallId(`pwsh-status-${index}`),
          name: 'pwsh', arguments: JSON.stringify({ command, description: 'Check synthetic PowerShell outcome' }) } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const results = options.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result')
    assert.equal(results.length, 4)
    for (const [index, result] of results.entries()) {
      const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').replace(/\r\n/g, '\n')
      assert.equal(result.isError, false)
      if (index === 0) {
        assert.ok(text.startsWith('before\n[stderr]\n'))
        // Stop promotes the error record; the displayed exception name varies by host/error view.
        assert.ok(text.includes('ToString') && text.includes('System.Byte[]'), text)
        assert.ok(text.endsWith('[exit code: 1]'))
        assert.ok(!text.includes('\nsha=') && !text.includes('\nafter\n'))
      } else {
        assert.equal(text, index === 1 ? 'HANDLED' : index === 2
          ? 'DIAGNOSTIC\n[stderr]\nMethodException is diagnostic text'
          : '[stderr]\nnative diagnostic\n[exit code: 7]')
      }
      this.transcript.push({ call: index, toolError: result.isError,
        commandExit: index === 0 ? 1 : index === 3 ? 7 : 0,
        // The actual PowerShell diagnostic is asserted above; formatting differs by PowerShell version.
        output: index === 0 ? 'before\n[stderr]\n<PowerShell argument-conversion error>\n[exit code: 1]' : text })
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Unhandled failure stopped; handled and diagnostic output preserved.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const [config] = process.argv.slice(2)
assert.ok(config)
const ctx = await boot('pwsh-error-status', config)
try {
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const adapter = new ErrorStatusAdapter()
  ctx.llm.registerAdapter(['fixture-pwsh'], adapter)
  const agent = ctx.agentLoop.create(SessionId('pwsh-error-status'), { provider: 'fixture-pwsh', model: 'keyless' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Compare synthetic PowerShell error outcomes.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  assert.deepEqual(errors, [], 'The scripted model and real tool loop must complete without agent errors.')
  assert.equal(adapter.requests, 2)
  assert.equal(adapter.transcript.length, 4)
  assert.equal(agent.session.events.filter(event => event.type === 'tool/result').length, 4)
  process.stdout.write(JSON.stringify(adapter.transcript) + '\n')
} finally {
  await ctx.fiber.dispose()
}
