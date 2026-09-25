/** Confirmed interview through the shipped Web composition and personal-memory store. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-tool-memory/review'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const root = fileURLToPath(new URL('./snapshots', import.meta.url))
const sessionId = SessionId('personal-interview-web')

describe('web e2e: personal interview', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: join(root, 'navigation-panes/catalog-only.jsonl'), replayProvidersOnly: true })
    await seedSession(scaffold, await readFile(join(root, 'navigation-panes/seed.jsonl'), 'utf8'), sessionId)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('does not save drafts, persists a confirmed fact and shows it after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'personal-interview'))
    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count()) await welcome.getByRole('button').click()
    await page.getByRole('button', { name: 'Search sessions' }).click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill('WATERFALL')
    await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').click()
    await page.getByRole('button', { name: 'Review memory', exact: true }).click()
    await page.getByRole('tab', { name: 'Personal', exact: true }).click()
    await page.getByRole('button', { name: "Let's talk", exact: true }).click()
    await page.getByLabel('What would you like me to call you?').fill('Test operator')
    await page.getByRole('button', { name: 'Continue without saving' }).click()
    for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Skip question' }).click()
    const before = await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })
    expect(before.ok && before.value.items).toEqual([])
    await compareOrRefreshGolden(join(root, 'personal-interview/review.expected.md'),
      await captureStableAria(page, '[aria-label="Getting to know you"]', scaffold.workspaceCwd), webSnapshotMode())
    await saveFailureShot(page, 'personal-interview-review')
    await page.setViewportSize({ width: 390, height: 844 })
    await saveFailureShot(page, 'personal-interview-mobile')
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.getByRole('button', { name: 'Confirm and save this fact' }).click()
    await page.getByText('Saved in personal memory. You can correct or forget it below.').waitFor()
    const after = await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })
    expect(after.ok && after.value.items.map(item => item.content)).toEqual(['What would you like me to call you?\nTest operator'])
    await page.reload()
    await page.getByRole('button', { name: 'Review memory', exact: true }).click()
    await page.getByRole('tab', { name: 'Personal', exact: true }).click()
    await page.getByText('What would you like me to call you?\nTest operator', { exact: true }).waitFor()
  })
})
