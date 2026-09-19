/** Plugin Center projection, conservative classification, and gated live controls. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway, { type Config } from '../src/index.ts'
import type { PluginEntryId } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(config: Config = {}): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway, config)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes inspection plus a deliberately narrow direct toggle method', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries with safe non-secret details', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    const localId = await ctx.loader.create({
      name: 'file:///C:/private/secret-plugin?token=never-project-this',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(4)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
        category: 'other',
        summary: 'Configured Cordis plugin.',
        capabilities: ['plugin lifecycle'],
        activation: 'restart-required',
      }),
      expect.objectContaining({
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
        activation: 'restart-required',
      }),
      expect.objectContaining({
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
        activation: 'restart-required',
      }),
      expect.objectContaining({
        entryId: localId,
        moduleName: 'local plugin',
        enabled: false,
        fiberPhase: null,
        category: 'other',
        activation: 'protected',
      }),
    ]))
    expect(JSON.stringify(snapshot)).not.toContain('private/secret-plugin')
    expect(JSON.stringify(snapshot)).not.toContain('token=never-project-this')

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toMatchObject({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
      activation: 'restart-required',
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('allows only exact deployment-audited optional entries to change live without writing configuration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.active = activePlugin
    const optionalId = await ctx.loader.create({ name: 'cordis:active' })
    const write = vi.spyOn(ctx.loader, 'write')
    await ctx.plugin(PluginInventoryGateway, {
      liveToggleEntries: [{ id: optionalId, moduleName: 'cordis:active' }],
    })
    const inventory = ctx.get('pluginInventory') as PluginInventoryGateway

    expect(inventory.list().entries.find(entry => entry.entryId === optionalId)).toMatchObject({
      activation: 'live-toggle', enabled: true,
    })
    await expect(inventory.setEnabled(optionalId as PluginEntryId, false)).resolves.toMatchObject({
      activation: 'live-toggle', enabled: false, fiberPhase: null,
    })
    expect(write).not.toHaveBeenCalled()
    await expect(inventory.setEnabled(optionalId as PluginEntryId, true)).resolves.toMatchObject({
      activation: 'live-toggle', enabled: true, fiberPhase: 'active',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('requires the exact public module identity paired with an audited configuration id', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.active = activePlugin
    const optionalId = await ctx.loader.create({ name: 'cordis:active' })
    await ctx.plugin(PluginInventoryGateway, {
      liveToggleEntries: [{ id: optionalId, moduleName: 'cordis:pending' }],
    })
    const inventory = ctx.get('pluginInventory') as PluginInventoryGateway

    expect(inventory.list().entries.find(entry => entry.entryId === optionalId)).toMatchObject({
      activation: 'restart-required', enabled: true,
    })
  })

  it('keeps core, structural, local, and unlisted entries read-only even when a caller guesses their ids', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.active = activePlugin
    const protectedId = await ctx.loader.create({ name: '@deepseek-ai/dsh-session', disabled: true })
    const groupId = await ctx.loader.create({ name: 'cordis:active', group: true })
    const localId = await ctx.loader.create({ name: 'file:///C:/private/plugin?token=never-toggle', disabled: true })
    await ctx.plugin(PluginInventoryGateway, {
      liveToggleEntries: [
        { id: protectedId, moduleName: '@deepseek-ai/dsh-session' },
        { id: groupId, moduleName: 'cordis:active' },
      ],
    })
    const inventory = ctx.get('pluginInventory') as PluginInventoryGateway

    expect(inventory.list().entries.find(entry => entry.entryId === protectedId)).toMatchObject({
      activation: 'protected', enabled: false,
    })
    await expect(inventory.setEnabled(protectedId as PluginEntryId, true)).rejects.toThrow(/protected from generic controls/)
    await expect(inventory.setEnabled(groupId as PluginEntryId, false)).rejects.toThrow(/Structural Loader groups are protected/)
    await expect(inventory.setEnabled(localId as PluginEntryId, true))
      .rejects.toThrow(/Local paths, URLs, and configuration-shaped plugin identities are protected/)
  })
})
