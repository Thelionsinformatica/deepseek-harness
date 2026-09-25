/** Memory overview reads the scoped host catalog without an inference or a memory write. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-tool-memory/review'
import type {} from '@deepseek-ai/dsh-workspace'
import type { PersonalMemoryGraphSnapshot } from '@deepseek-ai/dsh-personal-memory'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const root = fileURLToPath(new URL('./snapshots', import.meta.url))
const sessionId = SessionId('memory-capabilities-web')
const candidateEnabled = process.env['DSH_WEB_DASHBOARD_CANDIDATE'] === '1'

describe('web e2e: memory and effective capabilities', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let candidateRequests = 0
  let inferenceCalls = 0
  beforeAll(async () => {
    // Normal CI still exercises lib/client.js. Local candidate validation is explicit
    // and keeps Client project imports out of this Host test graph.
    let candidateCode: string | undefined
    if (candidateEnabled) {
      const built = await promisify(execFile)(process.execPath,
        ['--import', 'tsx/esm', fileURLToPath(new URL('./dashboard-candidate.mjs', import.meta.url))],
        { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })
      const candidate: unknown = JSON.parse(built.stdout)
      if (typeof candidate !== 'object' || candidate === null || !('code' in candidate)
        || typeof candidate.code !== 'string') throw new Error('Invalid in-memory dashboard candidate')
      candidateCode = candidate.code
    }
    scaffold = await launchWebScaffold({ replayFixture: join(root, 'navigation-panes/catalog-only.jsonl'), replayProvidersOnly: true })
    scaffold.ctx.on('llm/stream', async function* () {
      inferenceCalls += 1
      throw new Error('Memory overview must not call an inference provider')
    })
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const skillRoot = join(scaffold.workspaceCwd, '.agents', 'skills', 'safe-form-review')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: safe-form-review\ndescription: Inspect a local test form without submitting data.\n---\n\nRead the form. Do not submit it.\n')
    await seedSession(scaffold, await readFile(join(root, 'navigation-panes/seed.jsonl'), 'utf8'), sessionId)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    if (candidateCode !== undefined) {
      const body = candidateCode
      await page.route(url => url.origin === new URL(scaffold.baseUrl).origin
        && url.pathname === '/plugins/@deepseek-ai/dsh-client-ui-work-dashboard/client.js', async (route) => {
        candidateRequests += 1
        await route.fulfill({ status: 200, contentType: 'text/javascript', body })
      })
    }
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count()) await welcome.getByRole('button').click()
    await page.getByRole('button', { name: 'Search sessions' }).click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill('WATERFALL')
    await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').click()
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('shows persisted facts and project skills while leaving the stored facts unchanged', async () => {
    onTestFailed(() => saveFailureShot(page, 'memory-capabilities'))
    // Fix only the seed timestamp; real timers and later inspection remain live.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'))
    const remembered = await scaffold.ctx.memoryCandidateReview.rememberPersonalMemory({
      sessionId, content: 'I prefer concise reports with evidence.', confirmed: true,
    }).finally(() => { vi.useRealTimers() })
    expect(remembered.ok).toBe(true)
    const writes = [
      vi.spyOn(scaffold.ctx.memory, 'create'), vi.spyOn(scaffold.ctx.memory, 'update'), vi.spyOn(scaffold.ctx.memory, 'forget'),
      vi.spyOn(scaffold.ctx.personalMemory, 'create'), vi.spyOn(scaffold.ctx.personalMemory, 'update'), vi.spyOn(scaffold.ctx.personalMemory, 'forget'),
    ]
    onTestFinished(() => { for (const write of writes) write.mockRestore() })
    const before = await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })
    const beforeWorkspace = await scaffold.ctx.memoryCandidateReview.listMemories({ sessionId })
    expect(beforeWorkspace.ok).toBe(true)
    // Session selection hydrates persisted history asynchronously; measure after it is present.
    await expect.poll(() => scaffold.ctx.sessions.get(sessionId)).toBeDefined()
    const modelSteps = () => scaffold.ctx.sessions.get(sessionId)?.events.filter(event => event.type === 'assistant/message').length ?? 0
    const beforeSteps = modelSteps()
    await page.getByRole('button', { name: 'Review memory', exact: true }).click()
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    const overview = page.getByLabel('Memory and skills overview', { exact: true })
    await overview.getByRole('button', { name: 'safe-form-review Registered skill', exact: true }).waitFor()
    await overview.getByRole('button', { name: 'I prefer concise reports with evidence. Active', exact: true }).waitFor()
    expect(await overview.getByRole('alert').count()).toBe(0)
    expect(await overview.getByRole('complementary', { name: 'Agent profile', exact: true }).isVisible()).toBe(true)
    const graph = overview.getByRole('group', { name: 'Memory and skills graph by group', exact: true })
    const initialViewBox = await graph.getAttribute('viewBox')
    await overview.getByRole('button', { name: 'Zoom in graph', exact: true }).click()
    expect(await graph.getAttribute('viewBox')).not.toBe(initialViewBox)
    await overview.getByRole('button', { name: 'Reset graph zoom', exact: true }).click()
    expect(await graph.getAttribute('viewBox')).toBe(initialViewBox)
    await overview.getByRole('button', { name: 'Inspect node 1 in Personal', exact: true }).click()
    const details = overview.getByRole('complementary', { name: 'Record details', exact: true })
    expect(await details.getByText('I prefer concise reports with evidence.', { exact: true }).isVisible()).toBe(true)
    await overview.getByRole('button', { name: 'Records', exact: true }).click()
    expect(await graph.count()).toBe(0)
    expect(await overview.getByRole('button', { name: 'safe-form-review Registered skill' }).isVisible()).toBe(true)
    await overview.getByRole('button', { name: 'Graph', exact: true }).click()
    const calendar = overview.getByRole('region', { name: 'Latest changes calendar', exact: true })
    await calendar.getByText('September 2026', { exact: true }).waitFor()
    expect(await calendar.getByText('21', { exact: true }).getAttribute('class')).toContain('changedDay')
    await overview.getByRole('button', { name: 'safe-form-review Registered skill' }).click()
    await overview.getByText('Not evaluated by this inspection; permissions and approvals are checked during execution.', { exact: true }).waitFor()
    // Wall-clock dates are presentation-only; assertions keep all capability states intact.
    const snapshot = (await captureStableAria(page, '[aria-label="Memory and skills overview"]', scaffold.workspaceCwd))
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, '{{date}}')
    await mkdir(join(root, 'memory-capabilities'), { recursive: true })
    await compareOrRefreshGolden(join(root, 'memory-capabilities/overview.expected.md'),
      snapshot, webSnapshotMode())
    await page.getByRole('dialog').getByRole('heading', { name: 'Leon memory', exact: true }).scrollIntoViewIfNeeded()
    await saveFailureShot(page, 'memory-capabilities-desktop')
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    try {
      await saveFailureShot(page, 'memory-capabilities-desktop-dark')
    } finally {
      await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const dialog = page.getByRole('dialog')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const authorization = overview.getByText('Not evaluated by this inspection; permissions and approvals are checked during execution.', { exact: true })
    await authorization.scrollIntoViewIfNeeded()
    expect(await authorization.isVisible()).toBe(true)
    await saveFailureShot(page, 'memory-capabilities-mobile-details')
    const heading = dialog.getByRole('heading', { name: 'Leon memory', exact: true })
    await heading.scrollIntoViewIfNeeded()
    expect(await heading.isVisible()).toBe(true)
    expect(await dialog.getByRole('button', { name: 'Close memory review', exact: true }).isVisible()).toBe(true)
    await saveFailureShot(page, 'memory-capabilities-mobile')
    await overview.getByRole('button', { name: 'Refresh overview', exact: true }).click()
    await overview.getByRole('button', { name: 'safe-form-review Registered skill', exact: true }).waitFor()
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })).toEqual(before)
    expect(await scaffold.ctx.memoryCandidateReview.listMemories({ sessionId })).toEqual(beforeWorkspace)
    expect(modelSteps()).toBe(beforeSteps)
    if (candidateEnabled) expect(candidateRequests).toBeGreaterThan(0)
    else expect(candidateRequests).toBe(0)
    expect(inferenceCalls).toBe(0)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  }, 60_000)

  it('announces failed and stale graphs and draws only current revisions without writes or inference', async () => {
    onTestFailed(() => saveFailureShot(page, 'memory-graph-states'))
    // Fixture setup writes only to the scaffold's disposable store, before the
    // read-only guards. Keep lists and the graph RPC projection real; replace only
    // the published graph snapshot so failure timing does not depend on a model.
    const first = await scaffold.ctx.memoryCandidateReview.rememberPersonalMemory({
      sessionId, content: 'I prefer dated inspection reports.', confirmed: true,
    })
    const second = await scaffold.ctx.memoryCandidateReview.rememberPersonalMemory({
      sessionId, content: 'I prefer inspection reports with local evidence.', confirmed: true,
    })
    if (!first.ok || !second.ok) throw new Error('Could not seed graph inspection records')
    const corrected = await scaffold.ctx.memoryCandidateReview.correctPersonalMemory({
      sessionId, id: first.value.item.id, revision: first.value.item.revision,
      content: 'I prefer dated inspection reports with local evidence.', confirmed: true,
    })
    if (!corrected.ok) throw new Error('Could not seed the revised graph inspection record')
    const a = corrected.value.item
    const b = second.value.item
    const edges: PersonalMemoryGraphSnapshot['edges'] = [{
      a: { id: a.id, revision: a.revision }, b: { id: b.id, revision: b.revision },
      score: 0.9, kind: 'semantic',
    }]
    let personalGraph: Omit<PersonalMemoryGraphSnapshot, 'ownerId'> = {
      status: 'computed', generation: 1, algorithmVersion: 1,
      recordRevisions: { [a.id]: a.revision, [b.id]: b.revision }, edges,
    }
    const workspaceGraphRead = vi.spyOn(scaffold.ctx.memory, 'graph').mockImplementation(async ({ scope }) => ({
      workspaceId: scope.workspaceId, status: 'failed', generation: 1, algorithmVersion: 1,
      recordRevisions: {}, edges: [], failureCode: 'TIMEOUT',
    }))
    const personalGraphRead = vi.spyOn(scaffold.ctx.personalMemory, 'graph').mockImplementation(async ({ scope }) => ({
      ...personalGraph, ownerId: scope.ownerId,
    }))
    const writes = [
      vi.spyOn(scaffold.ctx.memory, 'create'), vi.spyOn(scaffold.ctx.memory, 'update'), vi.spyOn(scaffold.ctx.memory, 'forget'),
      vi.spyOn(scaffold.ctx.personalMemory, 'create'), vi.spyOn(scaffold.ctx.personalMemory, 'update'), vi.spyOn(scaffold.ctx.personalMemory, 'forget'),
    ]
    onTestFinished(() => {
      workspaceGraphRead.mockRestore()
      personalGraphRead.mockRestore()
      for (const write of writes) write.mockRestore()
    })
    const beforePersonal = await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })
    const beforeWorkspace = await scaffold.ctx.memoryCandidateReview.listMemories({ sessionId })
    await expect.poll(() => scaffold.ctx.sessions.get(sessionId)).toBeDefined()
    const modelSteps = () => scaffold.ctx.sessions.get(sessionId)?.events.filter(event => event.type === 'assistant/message').length ?? 0
    const beforeSteps = modelSteps()
    if (await page.getByRole('dialog').count() === 0) {
      await page.getByRole('button', { name: 'Review memory', exact: true }).click()
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    const overview = page.getByLabel('Memory and skills overview', { exact: true })
    const refresh = async (): Promise<void> => {
      const priorReads = personalGraphRead.mock.calls.length
      await overview.getByRole('button', { name: 'Refresh overview', exact: true }).click()
      await expect.poll(() => personalGraphRead.mock.calls.length).toBeGreaterThan(priorReads)
      await expect.poll(() => overview.getAttribute('aria-busy')).toBe('false')
    }
    const links = overview.locator('line[stroke-width]')
    await refresh()
    await expect.poll(() => overview.getByRole('alert', { name: 'Graph: Project', exact: true }).textContent())
      .toContain('Failure code: TIMEOUT')
    await expect.poll(() => overview.getByRole('status', { name: 'Graph: Personal', exact: true }).textContent())
      .toContain('Graph computed.')
    await expect.poll(() => links.count()).toBe(1)
    await overview.getByRole('region', { name: 'Personal', exact: true })
      .getByRole('button', { name: 'I prefer dated inspection reports with local evidence. Active', exact: true }).click()
    const details = overview.getByRole('complementary', { name: 'Record details', exact: true })
    await expect.poll(() => details.locator('dt', { hasText: /^Current revision$/ }).locator('+ dd').textContent())
      .toBe(String(a.revision))

    personalGraph = { ...personalGraph, status: 'stale' }
    await refresh()
    await expect.poll(() => overview.getByRole('status', { name: 'Graph: Personal', exact: true }).textContent())
      .toContain('Graph is stale. Previous connections stay hidden')
    expect(await links.count()).toBe(0)

    personalGraph = { ...personalGraph, status: 'failed', failureCode: 'fixture-provider-private-message' }
    await refresh()
    const failure = overview.getByRole('alert', { name: 'Graph: Personal', exact: true })
    await expect.poll(() => failure.textContent()).toContain('Graph computation failed.')
    expect(await failure.getAttribute('aria-atomic')).toBe('true')
    expect(await overview.textContent()).not.toContain('fixture-provider-private-message')
    expect(await links.count()).toBe(0)

    // A computed snapshot can race the independently read record list. An older
    // endpoint revision must not be reattached to the current node with that id.
    personalGraph = {
      status: 'computed', generation: 2, algorithmVersion: 1,
      recordRevisions: { [a.id]: first.value.item.revision, [b.id]: b.revision },
      edges: [{ a: { id: a.id, revision: first.value.item.revision }, b: { id: b.id, revision: b.revision }, score: 0.9, kind: 'semantic' }],
    }
    await refresh()
    await expect.poll(() => overview.getByRole('status', { name: 'Graph: Personal', exact: true }).textContent())
      .toContain('Graph computed.')
    expect(await links.count()).toBe(0)
    personalGraph = {
      ...personalGraph, generation: 3,
      recordRevisions: { [a.id]: a.revision, [b.id]: b.revision }, edges,
    }
    await refresh()
    await expect.poll(() => links.count()).toBe(1)
    await saveFailureShot(page, 'memory-graph-states-computed')
    expect(await scaffold.ctx.memoryCandidateReview.listPersonalMemories({ sessionId })).toEqual(beforePersonal)
    expect(await scaffold.ctx.memoryCandidateReview.listMemories({ sessionId })).toEqual(beforeWorkspace)
    expect(modelSteps()).toBe(beforeSteps)
    expect(inferenceCalls).toBe(0)
    expect(workspaceGraphRead).toHaveBeenCalled()
    if (candidateEnabled) expect(candidateRequests).toBeGreaterThan(0)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  }, 60_000)
})
