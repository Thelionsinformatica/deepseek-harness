/** The shipped Leon Work composition exposes real blank-session overview data. */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/leon-work-dashboard', import.meta.url))
const ACTION_MENU_EXPECTED = join(SNAPSHOT_DIR, 'action-menu.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Leon Work dashboard', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
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

  it('renders the overview and updates its project count from the live Workspace projection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-leon-work-dashboard'))
    const dashboard = page.getByRole('region', { name: 'Leon Work dashboard' })
    await dashboard.waitFor({ timeout: 30_000 })
    expect(await dashboard.getByRole('heading', { name: 'Your intelligent workspace' }).isVisible()).toBe(true)
    const projects = dashboard.locator('article').filter({ hasText: 'Projects' })
    await expect.poll(() => projects.textContent()).toContain('0')

    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'leon-work')

    await expect.poll(() => projects.textContent()).toContain('1')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Add to this task' })
    await menu.waitFor({ timeout: 10_000 })
    const menuSnapshot = await captureStableAria(
      page,
      '[role="menu"][aria-label="Add to this task"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(ACTION_MENU_EXPECTED, menuSnapshot, MODE)

    const chooserPromise = page.waitForEvent('filechooser')
    await menu.getByRole('menuitem', { name: /Files and folders/ }).click()
    const chooser = await chooserPromise
    expect(chooser.isMultiple()).toBe(true)
    await chooser.setFiles({
      name: 'leon-picker.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    const pending = page.getByRole('group', { name: 'Pending images' })
    await pending.waitFor({ timeout: 10_000 })
    expect(await pending.getByRole('img', { name: 'leon-picker.png' }).count()).toBe(1)
    await pending.getByRole('button', { name: 'Remove image leon-picker.png' }).click()
    await pending.waitFor({ state: 'detached', timeout: 10_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })

  it('shows the three-tier automatic policy without a default DeepSeek catalog', async () => {
    const automatic = page.getByRole('button', { name: /Leon Automatic, currently using Qwen 3\.5 9B/ })
    await automatic.waitFor({ timeout: 30_000 })
    await automatic.click()
    await page.getByRole('menuitem', { name: /Model Qwen 3\.5 9B/ }).click()

    const menu = page.getByRole('menu', { name: 'Model and reasoning effort' })
    await menu.getByRole('menuitemradio', {
      name: /Leon Automatic Uses the local 9B model at minimum effort, raises its effort for medium work/,
    }).waitFor({ timeout: 10_000 })
    expect(await menu.getByRole('menuitemradio', { name: 'Qwen 3.5 9B (Local)' }).count()).toBe(1)
    expect(await menu.getByRole('menuitemradio', { name: /Qwen 3\.5 4B/ }).count()).toBe(0)
    expect(await menu.getByText(/DeepSeek/i).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})
