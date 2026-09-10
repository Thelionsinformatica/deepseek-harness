// Web e2e scenario: the explicit native Web grant and Plugin Center operate
// through the shipped browser bundle, real command RPC, session log, Host
// projection, and Loader composition. No model or external provider request is
// needed: this pins the user decision and safe management surface itself.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-web-access'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const ENABLE_WEB_ACCESS = 'Enable web access for this session'
const DISABLE_WEB_ACCESS = 'Disable web access for this session'

describe('web e2e: explicit Web access and Plugin Center', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('records a session-only native Web grant and revokes it immediately through the composer button', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-access-control'))
    const enable = page.getByRole('button', { name: ENABLE_WEB_ACCESS, exact: true })
    await enable.waitFor({ timeout: 15_000 })
    expect(await enable.getAttribute('aria-pressed')).toBe('false')

    await enable.click()
    const disable = page.getByRole('button', { name: DISABLE_WEB_ACCESS, exact: true })
    await disable.waitFor({ timeout: 15_000 })
    expect(await disable.getAttribute('aria-pressed')).toBe('true')

    await disable.click()
    await enable.waitFor({ timeout: 15_000 })
    expect(await enable.getAttribute('aria-pressed')).toBe('false')

    const accessDecisions = sessionEvents.filter(
      (event): event is SessionEvent<'web/access'> => event.type === 'web/access',
    )
    expect(accessDecisions.map(event => event.data.enabled)).toEqual([true, false])
  })

  it('labels audited live plugins distinctly and withholds controls for protected entries', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-center'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
    await dialog.getByRole('tab', { name: 'Plugin Center', exact: true }).click()
    await dialog.getByRole('searchbox', { name: 'Search plugins', exact: true }).waitFor({ timeout: 15_000 })

    const fetchEntry = [...scaffold.ctx.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-web-fetch-http')
    expect(fetchEntry).toBeDefined()
    const fetchProvider = dialog.locator(`[data-plugin-entry="${fetchEntry!.id}"]`)
    await fetchProvider.waitFor({ timeout: 15_000 })
    expect(await fetchProvider.getByText('Live toggle', { exact: true }).count()).toBe(1)
    await fetchProvider.getByRole('button').click()
    expect(await fetchProvider.getByRole('button', { name: 'Disable now', exact: true }).count()).toBe(1)

    const accessEntry = [...scaffold.ctx.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-web-access')
    expect(accessEntry).toBeDefined()
    const accessService = dialog.locator(`[data-plugin-entry="${accessEntry!.id}"]`)
    await accessService.waitFor({ timeout: 15_000 })
    expect(await accessService.getByText('Protected', { exact: true }).count()).toBe(1)
    await accessService.getByRole('button').click()
    expect(await accessService.getByRole('button', { name: 'Disable now', exact: true }).count()).toBe(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
