/** Real upload, skill loading, filesystem read and durable conversation; only inference is scripted. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, type ContentBlock, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-skill'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const ROOT = fileURLToPath(new URL('./snapshots', import.meta.url))
const BODY = '# Documento sintético\n\nPedido: DOC-4721\nQuantidade: 3\nPreço unitário: R$ 40\nTotal: R$ 120\nPrazo: não informado.\n'
const ANSWER = 'DOC-4721: 3 itens de 40 reais; total de 120 reais. Prazo não informado. Fonte: documento.md, linhas 3–7.'
const SKILL = 'document-evidence-review'

function* emitBlock(block: ContentBlock): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: block.type }
  if (block.type === 'text') yield { type: 'text-delta', index: 0, text: block.text }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
}

describe.skipIf(MODE === 'record')('web e2e: document evidence journey', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let calls = 0
  let storedPath = ''
  let sessionId: SessionId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayFixture: join(ROOT, 'navigation-panes/catalog-only.jsonl'), replayProvidersOnly: true,
      toolsMode: 'native',
    })
    const skillDir = join(scaffold.workspaceCwd, 'workspace', '.agents', 'skills', SKILL)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---', `name: ${SKILL}`, 'description: Read attached documents and cite evidence without inventing missing facts.',
      '---', 'Read the attached file before answering. Cite its lines. Report missing facts explicitly.', '',
    ].join('\n'))
    // The script is a transport/execution oracle, not a benchmark of model reasoning.
    scaffold.ctx.on('llm/stream', async function* (options) {
      calls += 1
      const text = JSON.stringify(options.messages)
      expect(text).not.toContain('"type":"image"')
      if (calls === 1) {
        expect(text).toContain(SKILL)
        const pointers = options.messages.flatMap(message => message.content)
          .filter(block => block.type === 'text' && block.text.trim().startsWith('[arquivo anexado] '))
        const pointer = pointers[0]
        if (pointer?.type !== 'text') throw new Error('Missing document pointer')
        expect(pointer.text.startsWith('\n\n')).toBe(true)
        expect(pointer.text.endsWith('\n\n')).toBe(true)
        storedPath = pointer.text.trim().slice('[arquivo anexado] '.length)
        yield* emitBlock({ type: 'tool-call', id: CallId('load-document-skill'), name: 'skill', arguments: JSON.stringify({ name: SKILL }) })
      } else if (calls === 2) {
        expect(text).toContain('Report missing facts explicitly.')
        yield* emitBlock({ type: 'tool-call', id: CallId('read-document'), name: 'read', arguments: JSON.stringify({ file_path: storedPath }) })
      } else if (calls === 3) {
        expect(text).toContain('Prazo: não informado.')
        expect(text).toContain('Total: R$ 120')
        yield* emitBlock({ type: 'text', text: ANSWER })
      } else if (calls === 4) {
        expect(text).toContain('Prazo: não informado.')
        expect(text).toContain(ANSWER)
        yield* emitBlock({ type: 'text', text: 'RETOMADA: DOC-4721; prazo continua não informado.' })
      } else {
        throw new Error('Unexpected additional model call')
      }
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('uploads Markdown as text, loads the listed skill, reads unchanged bytes and persists evidence', async () => {
    onTestFailed(() => saveFailureShot(page, 'document-journey'))
    await page.locator('input[type="file"]').setInputFiles({ name: 'documento.md', mimeType: 'text/markdown', buffer: Buffer.from(BODY) })
    const settled = scaffold.whenTurnSettled()
    const composer = page.locator('textarea:enabled').last()
    await composer.fill('Analise o documento anexado usando a habilidade document-evidence-review. Informe total e prazo com evidência.')
    await composer.press('Enter')
    sessionId = await settled
    expect(calls).toBe(3)
    expect(await readFile(storedPath, 'utf8')).toBe(BODY)
    expect(await readdir(join(scaffold.harnessHome, 'uploads'))).toHaveLength(1)
    await page.getByText(ANSWER, { exact: false }).first().waitFor({ timeout: 10_000 })
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('Missing persisted document session')
    const events = session.events
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['skill', 'read'])
    const catalogs = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')
    expect(catalogs).toHaveLength(1)
    await scaffold.ctx.sessions.flush(session)
    const persisted = await scaffold.ctx.sessionPersistence.load(sessionId)
    expect(persisted.events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['skill', 'read'])
    expect(JSON.stringify(persisted.events)).toContain('Prazo: não informado.')
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    const stable = snapshot.split(storedPath).join('<attached-document>')
      .replace(/\d{4}-\d{2}-\d{2}T[\d-]+Z-documento\.md/gu, '<attached-document>')
      .split(scaffold.harnessHome).join('<harness-home>')
      .replace(/\{\{cwd\}\}[\\/]+\.dsh-home[\\/]+uploads[\\/]+<attached-document>/gu, '<attached-document>')
      .replace(/- button "\[arquivo anexado\][^\n]+/u, '- button "<document-session>" [disabled]')
    await compareOrRefreshGolden(join(ROOT, 'document-journey/ui.expected.md'), stable, MODE)
  }, 60_000)

  it('retains the document evidence after reopening the page without reading it again', async () => {
    await page.reload({ waitUntil: 'load' })
    await page.getByText(ANSWER, { exact: false }).first().waitFor({ timeout: 20_000 })
    const settled = scaffold.whenTurnSettled()
    const composer = page.locator('textarea:enabled').last()
    await composer.fill('Retome: qual era o prazo do pedido?')
    await composer.press('Enter')
    expect(await settled).toBe(sessionId)
    expect(calls).toBe(4)
    await page.getByText('RETOMADA: DOC-4721; prazo continua não informado.', { exact: false }).first().waitFor()
    const events = scaffold.ctx.sessions.get(sessionId)?.events ?? []
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(2)
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')).toHaveLength(1)
    expect(await readFile(storedPath, 'utf8')).toBe(BODY)
  }, 45_000)
})
