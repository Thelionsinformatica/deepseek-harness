// Real Loader + HTTP/WebSocket + Chromium, isolated settings and no model adapter.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const GOLDEN = fileURLToPath(new URL('./snapshots/skills-settings/section.expected.md', import.meta.url))

describe('web e2e: per-profile installed skill selection', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.skills.register({
      name: 'test-review', description: 'Review synthetic reports without changing files.',
      content: 'PRIVATE TEST BODY: never included in the settings response.', source: 'runtime',
    })
    scaffold.ctx.skills.register({
      name: 'test-user-only', description: 'Explicit user guidance for the synthetic test.',
      content: 'PRIVATE USER BODY', source: 'runtime',
      invocation: { modelInvocable: false, userInvocable: true },
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function openSkills(): Promise<void> {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Skills', exact: true }).click()
    await dialog.getByRole('switch', { name: 'test-review', exact: true }).waitFor()
  }

  it('persists a browser toggle, enforces it on the host, and leaves another profile enabled', async () => {
    onTestFailed(() => saveFailureShot(page, 'skills-settings'))
    await openSkills()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const profile = dialog.getByRole('combobox', { name: 'Agent profile', exact: true })
    await profile.selectOption('standard')
    const toggle = dialog.getByRole('switch', { name: 'test-review', exact: true })
    await expect.poll(() => toggle.isEnabled()).toBe(true)
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GOLDEN, snapshot, webSnapshotMode())
    expect(snapshot).not.toContain('PRIVATE TEST BODY')
    expect(snapshot).toContain('Model invocation: Restricted')
    const originalDefault = scaffold.ctx.agentPresets.defaultId

    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await expect.poll(() => toggle.isEnabled()).toBe(true)
    const standard = await scaffold.ctx.agentPresets.standingKeyFor('standard')
    expect(await scaffold.ctx.skills.get('test-review', { scope: standard })).toBeUndefined()
    expect((await scaffold.ctx.skills.inventory({ scope: standard })).skills.some(skill => skill.name === 'test-review')).toBe(true)
    expect((await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))).toContain('test-review')

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await openSkills()
    await profile.selectOption('standard')
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await profile.selectOption('minimal')
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    const minimal = await scaffold.ctx.agentPresets.standingKeyFor('minimal')
    expect(await scaffold.ctx.skills.get('test-review', { scope: minimal })).toBeDefined()

    await profile.selectOption('standard')
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
    await expect.poll(() => toggle.isEnabled()).toBe(true)
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    expect(await scaffold.ctx.skills.get('test-review', { scope: standard })).toBeDefined()
    expect(scaffold.ctx.agentPresets.defaultId).toBe(originalDefault)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    const artifactDir = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await mkdir(artifactDir, { recursive: true })
    await page.screenshot({ path: join(artifactDir, 'skills-settings.png'), fullPage: true })
  }, 90_000)
})
