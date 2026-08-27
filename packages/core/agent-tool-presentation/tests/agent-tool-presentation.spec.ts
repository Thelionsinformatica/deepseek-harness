/**
 * The row an agent preset carries to pick its tool presentation. What it owes
 * its caller: the choice reaches THIS agent and no other, it unwinds with the
 * agent, and a code mode composed against a deployment with no code runtime
 * stops at mount — where a preset's activation audit can name it — rather
 * than at the first prompt assembly.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import ToolRuntime, { RUN_CODE_NAME, defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, Config, inject, name } from '@deepseek-ai/dsh-agent-tool-presentation'

const FULL_TOOL_DESCRIPTION = 'Echo a supplied value with a deliberately verbose description for compact local prompts.'
const FULL_PARAMETER_DESCRIPTION = 'The exact value that the echo tool returns to its caller without modification.'

/** A runtime that never runs anything: presentation never dispatches. */
class StubRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'stub'

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

/** A host plane with one tool, optionally carrying a code runtime. */
async function host(options: { runtime?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  if (options.runtime !== false) await ctx.plugin(StubRuntime)
  ctx.tools.register(defineTool({
    name: 'echo',
    description: FULL_TOOL_DESCRIPTION,
    parameters: {
      value: { type: 'string', required: true, description: FULL_PARAMETER_DESCRIPTION },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: args => Promise.resolve(args.value),
  }))
  return ctx
}

/** Mount the row under one agent's scope, as a preset subtree does. */
async function mount(ctx: Context, config: Config, id = 'agent') {
  const agent = { id: SessionId(id) } as Agent
  let inner!: Context
  const fiber = ctx.plugin(Object.assign((host: Context) => {
    inner = createScope(host, agent).ctx
  }, { inject: ['tools', 'systemPrompt'] }))
  await fiber.await()
  const row = inner.plugin({ name, inject: [...inject], Config, apply }, config)
  await row.await()
  return { agent, fiber, row }
}

describe('the tool-presentation row', () => {
  it('declares the services it uses without holding a code runtime hostage', () => {
    // A `native` row must mount where no runtime is composed, so the wait is
    // conditional inside apply rather than static metadata.
    expect(inject).toEqual(['tools'])
  })

  it('gives its own agent Code Mode and leaves the rest native', async () => {
    const ctx = await host()
    const coded = await mount(ctx, { mode: 'code' }, 'coded')
    const plain = await mount(ctx, { mode: 'native' }, 'plain')

    const codedAssembly = await ctx.systemPrompt.assemble({ scope: coded.agent })
    const plainAssembly = await ctx.systemPrompt.assemble({ scope: plain.agent })

    expect(codedAssembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(codedAssembly.sections.find(section => section.name === 'tools:sdk')?.text).toContain('echo')
    expect(plainAssembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('presents both forms when asked for both', async () => {
    const ctx = await host()
    const { agent } = await mount(ctx, { mode: 'both' })

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })

    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo', RUN_CODE_NAME])
  })

  it('compacts model-facing descriptions without changing the executable definition', async () => {
    const ctx = await host()
    const { agent } = await mount(ctx, { mode: 'native', descriptionMaxLength: 24 })

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    const schema = assembly.tools.find(tool => tool.name === 'echo')
    const properties = schema?.parameters.properties as Record<string, { description?: string }> | undefined

    expect({
      description: schema?.description,
      parameterDescription: properties?.value?.description,
    }).toMatchInlineSnapshot(`
      {
        "description": "Echo a supplied value...",
        "parameterDescription": "The exact value that ...",
      }
    `)
    expect(ctx.tools.get('echo', agent)?.description).toBe(FULL_TOOL_DESCRIPTION)
  })

  it('restores the deployment default when the agent unloads', async () => {
    const ctx = await host()
    const { agent, row } = await mount(ctx, { mode: 'code' })

    await row.dispose()

    // HMR safety: the preset subtree is torn down with its agent, and the
    // presentation must go with it rather than outliving the composition.
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(assembly.sections.some(section => section.name === 'tools:sdk')).toBe(false)
  })

  it('waits for a code runtime the deployment does not compose', async () => {
    const ctx = await host({ runtime: false })

    const { agent, row } = await mount(ctx, { mode: 'code' })

    // Pending, not applied: `dsh-agent-presets` rejects a mount holding a row
    // that never reached a usable state, naming this id — so the preset fails
    // where the operator can act, instead of at the first request.
    expect(row.ctx.get('codeRuntime')).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
  })

  it('applies once the runtime arrives', async () => {
    const ctx = await host({ runtime: false })
    const { agent } = await mount(ctx, { mode: 'code' })

    await ctx.plugin(StubRuntime)

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
  })

  it('requires a mode rather than defaulting one', () => {
    // An omitted value would mean the row was composed for nothing: a preset
    // without this row already gets the deployment default.
    expect(() => Config({} as never)).toThrow()
    expect(() => Config({ mode: 'native', descriptionMaxLength: 2 })).toThrow()
  })
})
