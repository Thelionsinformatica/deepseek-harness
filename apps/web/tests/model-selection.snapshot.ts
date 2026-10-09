// Official assembled keyless selector coverage: real Loader, HTTP/WebSocket,
// settings, model directory and Chromium over the built Web client. Only the
// provider catalog is synthetic; no prompt, inference or credential is used.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const OVERLAY = fileURLToPath(new URL('./model-selection.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/model-selection', import.meta.url))
const GOLDENS = ['catalog.expected.md', 'search.expected.md', 'adaptive.expected.md', 'team.expected.md']

describe.skipIf(MODE === 'record')('web snapshot: searchable model modes and Host details', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const promptRequests: string[] = []
  const externalRequests: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        'selector-main': {
          displayName: 'Selector Main', api: 'openai-completions',
          baseURL: 'https://main.selector.example/v1',
          models: [
            { id: 'fast-text', name: 'Fast Text', contextWindow: 64_000, maxTokens: 2_048, input: ['text'], reasoningEfforts: false },
            { id: 'main-think', name: 'Main Think', contextWindow: 1_000_000, maxTokens: 4_096, input: ['text', 'image'],
              reasoningEfforts: { off: null, high: 'high', max: 'ultra' } },
          ],
        },
        'selector-review': {
          displayName: 'Selector Review', api: 'openai-completions',
          baseURL: 'https://review.selector.example/v1',
          models: [{ id: 'review-text', name: 'Review Text', contextWindow: 128_000, maxTokens: 3_072, input: ['text'], reasoningEfforts: false }],
        },
      },
    })
    if (MODE === 'refresh') await mkdir(SNAPSHOT_DIR, { recursive: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('request', (request) => {
      if (request.url().includes('/api/session.prompt')) promptRequests.push(request.url())
      if (/^https?:/.test(request.url()) && !request.url().startsWith(scaffold.baseUrl)) externalRequests.push(request.url())
    })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** Read the exact active browser session through the real Host contract. */
  const currentModels = async (): Promise<SessionModels> => {
    const agents = scaffold.ctx.agents.list()
    expect(agents).toHaveLength(1)
    const agent = agents[0]
    if (agent === undefined) throw new Error('No browser session agent')
    const response = await scaffold.ctx.apiProxy.sessions.models({
      rpcId: 'selector-snapshot-models' as never,
      payload: { sessionId: agent.session.id },
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }

  const capture = async (name: string): Promise<void> => {
    const actual = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, name), actual, MODE)
  }

  it('renders the catalog and details, filters search and applies manual/team/adaptive without inference', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-snapshot-model-selection'))
    const trigger = page.getByRole('button', { name: /^(Select model|Leon Automatic|Leon Team)/ })
    const menu = page.getByRole('menu', { name: 'Model and reasoning effort' })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('searchbox', { name: 'Search models' }).waitFor()
    await expect.poll(() => menu.getByRole('menuitemradio').count()).toBe(3)
    expect(await menu.getByRole('menuitem', { name: 'Leon Adaptive', exact: true }).count()).toBe(1)
    expect(await menu.getByRole('menuitem', { name: 'Leon Team', exact: true }).count()).toBe(1)

    // A hover is inspection, not a route mutation. Metadata is Host-owned;
    // absent pricing must not become "free" or fabricated dollar amounts.
    const beforeInspection = await currentModels()
    await menu.getByRole('menuitemradio', { name: 'Main Think', exact: true }).hover()
    const details = menu.getByRole('region', { name: 'Model details' })
    await expect.poll(() => details.textContent()).toContain('main-think')
    expect(await details.textContent()).toContain('1000000 tokens')
    expect(await details.textContent()).toContain('4096 tokens')
    expect(await details.textContent()).toContain('Text · Images')
    expect(await details.locator('dt', { hasText: /^Pricing$/ }).locator('xpath=following-sibling::dd[1]').textContent()).toBe('Not provided')
    expect((await currentModels()).current).toEqual(beforeInspection.current)
    await capture('catalog.expected.md')

    const search = page.getByRole('searchbox', { name: 'Search models' })
    await search.fill('selector-review')
    await expect.poll(() => menu.getByRole('menuitemradio').allTextContents()).toEqual(['Review Text'])
    await menu.getByRole('menuitemradio', { name: 'Review Text', exact: true }).hover()
    await capture('search.expected.md')
    await search.fill('not-in-this-catalog')
    await expect.poll(() => menu.getByRole('menuitemradio').count()).toBe(0)
    expect(await menu.getByText('No models match your search.', { exact: true }).count()).toBe(1)
    await search.press('Escape')
    expect(await search.inputValue()).toBe('')
    await expect.poll(() => menu.getByRole('menuitemradio').count()).toBe(3)

    await menu.getByRole('menuitemradio', { name: 'Review Text', exact: true }).click()
    await expect.poll(async () => (await currentModels()).selectionMode).toBe('manual')
    expect((await currentModels()).current).toEqual({ provider: 'selector-review', model: 'review-text' })
    expect((await currentModels()).externalFailoverConsent).toBe(false)
    // Explicit per-session manual mode must leave the configured Team lead alone.
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'selector-main', model: 'main-think' })

    await trigger.click()
    await menu.getByRole('menuitemradio', { name: 'Main Think', exact: true }).click()
    await expect.poll(async () => (await currentModels()).current.model).toBe('main-think')
    await trigger.click()
    await menu.getByRole('menuitem', { name: /^Effort/ }).click()
    await expect.poll(() => menu.getByRole('menuitemradio').allTextContents()).toEqual(['Default', 'Off', 'High', 'Max'])
    await menu.getByRole('menuitemradio', { name: 'High', exact: true }).click()
    await expect.poll(async () => (await currentModels()).current.reasoningEffort).toBe('high')

    await trigger.click()
    await menu.getByRole('menuitem', { name: 'Leon Team', exact: true }).click()
    expect(await menu.textContent()).toContain('Selector Main · Main Think')
    expect(await menu.textContent()).toContain('Selector Main · Fast Text')
    expect(await menu.textContent()).toContain('Selector Review · Review Text')
    expect(await menu.textContent()).toContain('does not start a mission, force delegation')
    await capture('team.expected.md')
    await menu.getByRole('menuitem', { name: 'Enable team mode', exact: true }).click()
    await expect.poll(async () => (await currentModels()).selectionMode).toBe('team')
    expect((await currentModels()).automatic).toBe(true)
    expect((await currentModels()).current).toMatchObject({ provider: 'selector-main', model: 'main-think' })
    await expect.poll(() => trigger.getAttribute('aria-label')).toBe('Leon Team, current coordinator Main Think')

    await trigger.click()
    await menu.getByRole('menuitem', { name: 'Leon Adaptive', exact: true }).click()
    expect(await menu.getByRole('menuitemcheckbox', { name: /^Allow API fallback/ }).getAttribute('aria-checked')).toBe('false')
    await capture('adaptive.expected.md')
    await menu.getByRole('menuitem', { name: 'Save preference', exact: true }).click()
    await expect.poll(async () => (await currentModels()).selectionMode).toBe('adaptive')
    expect((await currentModels()).externalFailoverConsent).toBe(false)
    expect((await currentModels()).current).toEqual({ provider: 'selector-main', model: 'fast-text' })

    // Real browser geometry: wide details beside search, narrow details below;
    // menu stays within the viewport and has no horizontal overflow.
    await trigger.click()
    for (const width of [1680, 590]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(async () => menu.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= -1 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1
      }), { timeout: 10_000, message: `Selector must fit the ${width}px viewport without overflow` }).toBe(true)
      const searchBox = await search.boundingBox()
      const detailBox = await details.boundingBox()
      if (searchBox === null || detailBox === null) throw new Error('Selector layout missing')
      if (width > 600) expect(detailBox.x).toBeGreaterThan(searchBox.x + searchBox.width)
      else expect(detailBox.y).toBeGreaterThan(searchBox.y + searchBox.height)
      // A bounded empty card is not usable: assert a real row remains visible
      // in a non-collapsed scrolling catalog after each responsive transition.
      const firstModel = menu.getByRole('menuitemradio').first()
      await firstModel.scrollIntoViewIfNeeded()
      expect(await firstModel.evaluate(element => element.parentElement?.parentElement?.clientHeight ?? 0)).toBeGreaterThan(20)
      const rowBox = await firstModel.boundingBox()
      const menuBox = await menu.boundingBox()
      if (rowBox === null || menuBox === null) throw new Error('Visible catalog row missing')
      expect(rowBox.x).toBeGreaterThanOrEqual(menuBox.x)
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(menuBox.x + menuBox.width)
      expect(rowBox.y).toBeGreaterThanOrEqual(menuBox.y)
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height)
      await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts', `model-selection-${width}.png`), fullPage: true })
    }
    await search.press('Escape')
    await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
    expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true)

    expect(promptRequests).toEqual([])
    expect(externalRequests).toEqual([])
    for (const agent of scaffold.ctx.agents.list()) {
      expect(agent.session.events.some(event => event.type === 'turn/start' || event.type === 'request/header')).toBe(false)
    }
    expect(scaffold.ctx.agents.list()).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('keeps the keyless golden inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, GOLDENS)
  })
})
