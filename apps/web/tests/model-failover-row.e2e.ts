// Keyless browser regression for Leon Automatic provider failover. A settled
// session is assembled through the real Session API, seeded cold, and rendered
// by the shipped Web composition so the durable user notice cannot regress.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/model-failover-row', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/model-failover-row/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'model-failover-row-web-e2e'
const DONE = 'Automatic failover completed.'

/** Build one settled turn whose first local route was replaced by Gemini. */
function failoverFixture(): string {
  const session = Session.create(SessionId('model-failover-row-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Continue even if the local model is unavailable.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Automatic model failover',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'ollama', model: 'qwen3.5:9b' } },
    reason: 'initial',
  })
  session.append('llm/failover', {
    turn: 1,
    step: 1,
    from: { provider: 'ollama', model: 'qwen3.5:9b' },
    to: { provider: 'google', model: 'gemini-3.1-pro-preview-customtools' },
    failure: { code: 'TRANSPORT', message: 'connection refused' },
    reason: 'provider-unavailable',
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: DONE }],
      source: { kind: 'model', provider: 'google', model: 'gemini-3.1-pro-preview-customtools' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: automatic model failover notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, failoverFixture(), SEED_ID)
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

  it.skipIf(MODE === 'record')('renders the durable local-unavailable notice in the assembled app', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-failover-row'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    await page.getByText(DONE, { exact: true }).waitFor({ timeout: 15_000 })
    const notice = page.getByRole('status').filter({ hasText: 'ollama unavailable' })
    await notice.waitFor({ timeout: 10_000 })
    expect(await notice.textContent()).toContain('gemini-3.1-pro-preview-customtools')
    expect(await notice.textContent()).toContain('qwen3.5:9b')
    expect(await page.locator('body').textContent()).not.toContain('connection refused')

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
