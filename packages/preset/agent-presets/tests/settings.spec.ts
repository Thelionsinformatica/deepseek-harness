/**
 * The default preset is a user setting. `config.default` is the deployment's
 * engineering default; the settings document overrides it and is hot-reloaded,
 * so a person can change which preset new sessions get without a restart.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-presets'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { scopeOf } from '@deepseek-ai/dsh-scope'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [{ path: join(FIXTURES, 'system'), trust: 'system' as const }]
const NS = settingsNamespace(SETTINGS_NAMESPACE)

/**
 * A composition with a real file-backed settings provider. `settingsFiber` is
 * the provider's own handle, so a test can take it away the way a reload does.
 */
async function harness(
  extraRoots: readonly { path: string; trust: 'system' | 'user' }[] = [],
  existingSettingsFile?: string,
): Promise<{ ctx: Context; settingsFile: string; settingsFiber: { dispose: () => unknown } }> {
  const settingsFile = existingSettingsFile ?? join(await mkdtemp(join(tmpdir(), 'dsh-preset-settings-')), 'settings.yaml')
  if (existingSettingsFile === undefined) await writeFile(settingsFile, '{}\n')

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: settingsFile, watch: false })
  await settingsFiber
  await ctx.plugin(AgentPresets, { default: 'standard', roots: [...ROOTS, ...extraRoots], includeUserRoot: false })
  return { ctx, settingsFile, settingsFiber }
}

const toolNames = (ctx: Context, agent?: unknown): string[] =>
  ctx.tools.schemas(agent as never).map(schema => schema.name).sort()

describe('the default preset as a user setting', () => {
  it('falls back to the composition default while the user set none', async () => {
    const { ctx } = await harness()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('takes the user default over the composition default', async () => {
    const { ctx } = await harness()

    await ctx.settings.update(NS, { default: 'minimal' })

    expect(ctx.agentPresets.defaultId).toBe('minimal')
  })

  it('composes a new session from the user default', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })

    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-default'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, handle.agent)).toEqual(['beta'])
    } finally {
      await handle.dispose()
    }
  })

  it('leaves a running session on the preset it was composed from', async () => {
    const { ctx } = await harness()
    const running = await ctx.agents.create({
      sessionId: SessionId('settings-running'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      // Changing the default mid-flight must not reach an agent that already
      // composed: its history was produced under `standard`'s tools.
      await ctx.settings.update(NS, { default: 'minimal' })

      expect(ctx.agentPresets.defaultId).toBe('minimal')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])
    } finally {
      await running.dispose()
    }
  })

  it('re-inherits the composition default when the user setting is cleared', async () => {
    const { ctx } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    await ctx.settings.replace(NS, {})

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('clears a user default it has just deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx } = await harness([{ path: root, trust: 'user' as const }])
    await ctx.settings.update(NS, { default: 'mine' })
    expect(ctx.agentPresets.defaultId).toBe('mine')

    await ctx.agentPresets.remove('mine')

    // Nothing will ever supply that id again, so leaving the setting pointed at
    // it would fail every session created without an explicit pick. Clearing it
    // exposes the deployment's own default underneath.
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
  })

  it('reports an unknown user default only when a session tries to use it', async () => {
    const { ctx } = await harness()

    // Storing it succeeds — the roster is a live directory, so a name that is
    // absent now may exist by the time a session asks for it.
    await ctx.settings.update(NS, { default: 'no-such-preset' })

    await expect(ctx.agentPresets.resolve())
      .rejects.toThrow(/preset "no-such-preset" not found/)
  })
})

describe('a settings provider that goes away', () => {
  it('falls back to the composition default when the provider unloads', async () => {
    const { ctx, settingsFiber } = await harness()
    await ctx.settings.update(NS, { default: 'minimal' })
    expect(ctx.agentPresets.defaultId).toBe('minimal')

    // Unloading the provider takes the user layer with it; the roster keeps
    // working on its composition default rather than holding a stale override.
    await settingsFiber.dispose()

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })
})

describe('skill selection belongs to the persisted preset', () => {
  it('retains an isolated registry restriction after the Loader replaces that registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-local-skills-'))
    const presetDir = join(root, 'local-skills')
    await mkdir(presetDir)
    const composition = '- id: registry\n  name: cordis:test-skill-registry\n  isolate:\n    skills: true\n'
    const compositionFile = join(presetDir, COMPOSITION_FILE)
    await writeFile(compositionFile, composition)
    const { ctx } = await harness([{ path: root, trust: 'user' }])
    ctx.loader.builtins['test-skill-registry'] = SkillRegistry
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'example-skill', description: 'Host skill', content: 'Host body', source: 'runtime' })
    await ctx.settings.update(NS, { disabledSkills: { 'local-skills': ['example-skill'] } })
    try {
      const scope = await ctx.agentPresets.standingKeyFor('local-skills')
      const before = await ctx.agentPresets.serviceForPreset('local-skills', 'skills')
      if (before === undefined) throw new Error('expected isolated skill registry')
      before.register({ name: 'example-skill', description: 'Local skill', content: 'Local body', source: 'runtime' })
      expect(before.isEnabled('example-skill', { scope })).toBe(false)
      expect(await before.get('example-skill', { scope })).toBeUndefined()
      expect(await ctx.skills.get('example-skill')).toBeDefined()
      const impl = Object.getOwnPropertySymbols(ctx.reflect.store)
        .map(key => ctx.reflect.store[key])
        .find(value => value?.name === 'skills' && scopeOf(value.fiber.ctx) === scope)
      const entry = impl?.fiber.entry
      if (entry === undefined) throw new Error('expected Loader-owned isolated registry')
      await entry.update({ disabled: true })
      await entry.update({ disabled: false })
      await ctx.loader.await()
      expect(await ctx.agentPresets.standingKeyFor('local-skills')).toBe(scope)
      const after = await ctx.agentPresets.serviceForPreset('local-skills', 'skills')
      if (after === undefined) throw new Error('expected replacement skill registry')
      expect(after.isEnabled('example-skill', { scope })).toBe(false)
      after.register({ name: 'example-skill', description: 'Reloaded skill', content: 'Reloaded body', source: 'runtime' })
      expect(await after.get('example-skill', { scope })).toBeUndefined()
      expect((await after.inventory({ scope })).skills).toHaveLength(1)
      expect(await ctx.skills.get('example-skill')).toBeDefined()
      await ctx.settings.mutate(NS, [{ op: 'set', path: ['disabledSkills', 'local-skills'], value: [] }])
      expect(await after.get('example-skill', { scope })).toBeDefined()
      expect(await readFile(compositionFile, 'utf8')).toBe(composition)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('denies new loads for the selected preset and its children, not siblings, then re-enables live', async () => {
    const { ctx, settingsFile } = await harness()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'example-skill', description: 'Example', content: 'PRIVATE SKILL BODY', source: 'runtime' })
    const lead = await ctx.agents.create({
      sessionId: SessionId('selection-lead'),
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    const child = await ctx.agents.create({
      sessionId: SessionId('selection-child'),
      setup: (agentCtx) => { ctx.agentPresets.composeFrom(agentCtx, lead.agent.ctx) },
    })
    try {
      const standard = await ctx.agentPresets.standingKeyFor('standard')
      const minimal = await ctx.agentPresets.standingKeyFor('minimal')
      expect(await ctx.skills.get('example-skill', { scope: lead.agent })).toBeDefined()
      await ctx.settings.update(NS, { disabledSkills: { standard: ['example-skill'] } })
      expect(await ctx.skills.get('example-skill', { scope: lead.agent })).toBeUndefined()
      expect(await ctx.skills.get('example-skill', { scope: child.agent })).toBeUndefined()
      expect(await ctx.skills.list({ scope: standard })).toEqual([])
      expect((await ctx.skills.inventory({ scope: standard })).skills.map(skill => skill.name)).toEqual(['example-skill'])
      expect(await ctx.skills.get('example-skill', { scope: minimal })).toBeDefined()
      expect(await readFile(settingsFile, 'utf8')).toContain('example-skill')
      expect(await ctx.agentPresets.serviceForPreset('standard', 'skills')).toBeDefined()
      await ctx.settings.mutate(NS, [{ op: 'set', path: ['disabledSkills', 'standard'], value: [] }])
      expect(await ctx.skills.get('example-skill', { scope: child.agent })).toBeDefined()
      expect(ctx.agentPresets.defaultId).toBe('standard')
    } finally {
      await child.dispose()
      await lead.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('retains the last restriction when settings disappears and loads it before the first agent', async () => {
    const { ctx, settingsFiber } = await harness()
    await ctx.settings.update(NS, { disabledSkills: { standard: ['example-skill'] } })
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'example-skill', description: 'Example', content: 'Body', source: 'runtime' })
    try {
      const scope = await ctx.agentPresets.standingKeyFor('standard')
      expect(await ctx.skills.get('example-skill', { scope })).toBeUndefined()
      await settingsFiber.dispose()
      expect(await ctx.skills.get('example-skill', { scope })).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reloads the persisted selection in a new host before any agent is created', async () => {
    const first = await harness()
    await first.ctx.settings.update(NS, { disabledSkills: { standard: ['example-skill'] } })
    await first.ctx.fiber.dispose()
    const second = await harness([], first.settingsFile)
    try {
      await second.ctx.plugin(SkillRegistry)
      second.ctx.skills.register({ name: 'example-skill', description: 'Example', content: 'Body', source: 'runtime' })
      const scope = await second.ctx.agentPresets.standingKeyFor('standard')
      expect(second.ctx.skills.isEnabled('example-skill', { scope })).toBe(false)
      expect(await second.ctx.skills.get('example-skill', { scope })).toBeUndefined()
      expect((await second.ctx.skills.inventory({ scope })).skills).toHaveLength(1)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })
})
