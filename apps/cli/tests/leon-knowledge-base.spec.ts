import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'

const script = fileURLToPath(new URL(
  '../config/agent-presets/leon/skills/leon-knowledge-base/scripts/knowledge.mjs',
  import.meta.url,
))
const temporaryDirectories: string[] = []

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'leon-knowledge-base-'))
  temporaryDirectories.push(directory)
  return directory
}

async function run(args: string[]) {
  const result = await execa(process.execPath, [script, ...args], { reject: false })
  return {
    exitCode: result.exitCode,
    body: JSON.parse(result.stdout) as Record<string, unknown>,
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Leon knowledge base helper', () => {
  it('initializes the versioned workspace layout without overwriting it', async () => {
    const directory = await workspace()
    const first = await run(['init', '--workspace', directory])
    const second = await run(['init', '--workspace', directory])

    expect(first.exitCode).toBe(0)
    expect(first.body).toMatchObject({ ok: true, command: 'init', created: ['schema.yml', 'index.md', 'log.md'] })
    expect(second.body).toMatchObject({ ok: true, command: 'init', created: [] })
    await expect(readFile(join(directory, '.leon', 'knowledge', 'schema.yml'), 'utf8'))
      .resolves.toContain('raw: immutable')
  })

  it('preserves a source by hash, creates a pending page, and ignores duplicate ingestion', async () => {
    const directory = await workspace()
    const source = join(directory, 'manual.md')
    await writeFile(source, '# Manual\n\nO enlace usa VLAN 320.\n', 'utf8')

    const first = await run(['ingest', '--workspace', directory, '--source', source, '--title', 'Manual da rede'])
    const second = await run(['ingest', '--workspace', directory, '--source', source, '--title', 'Outro título'])
    const page = first.body.page as string
    const rawFile = first.body.rawFile as string

    expect(first.body).toMatchObject({ ok: true, duplicate: false, copied: true, status: 'pending_synthesis' })
    expect(second.body).toMatchObject({ ok: true, duplicate: true, copied: false })
    await expect(readFile(join(directory, '.leon', 'knowledge', ...rawFile.split('/')), 'utf8'))
      .resolves.toBe('# Manual\n\nO enlace usa VLAN 320.\n')
    await expect(readFile(join(directory, '.leon', 'knowledge', ...page.split('/')), 'utf8'))
      .resolves.toContain('title: "Manual da rede"')
    await expect(readFile(join(directory, '.leon', 'knowledge', 'index.md'), 'utf8'))
      .resolves.toContain('Manual da rede')
    expect((await run(['lint', '--workspace', directory])).body).toMatchObject({ ok: true, sources: 1, issues: [] })
  })

  it('detects a modified raw source instead of accepting it as knowledge', async () => {
    const directory = await workspace()
    const source = join(directory, 'source.txt')
    await writeFile(source, 'valor confirmado', 'utf8')
    const ingested = await run(['ingest', '--workspace', directory, '--source', source])
    const rawFile = ingested.body.rawFile as string
    await writeFile(join(directory, '.leon', 'knowledge', ...rawFile.split('/')), 'valor adulterado', 'utf8')

    const report = await run(['lint', '--workspace', directory])

    expect(report.exitCode).toBe(0)
    expect(report.body).toMatchObject({ ok: false })
    expect(report.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RAW_HASH_MISMATCH' }),
    ]))
  })

  it('rejects sources outside the workspace and files that resemble credentials', async () => {
    const directory = await workspace()
    const outside = await workspace()
    const outsideFile = join(outside, 'outside.txt')
    await writeFile(outsideFile, 'outside', 'utf8')
    const secret = join(directory, '.env')
    await writeFile(secret, 'API_KEY=012345678901234567890123456789', 'utf8')

    const escaped = await run(['ingest', '--workspace', directory, '--source', outsideFile])
    const sensitive = await run(['ingest', '--workspace', directory, '--source', secret])

    expect(escaped).toMatchObject({ exitCode: 1, body: { ok: false, error: { code: 'SOURCE_OUTSIDE_WORKSPACE' } } })
    expect(sensitive).toMatchObject({ exitCode: 1, body: { ok: false, error: { code: 'SENSITIVE_SOURCE' } } })
  })

  it('reports status counts and broken wiki links', async () => {
    const directory = await workspace()
    const source = join(directory, 'source.md')
    await writeFile(source, '# Fonte', 'utf8')
    const ingested = await run(['ingest', '--workspace', directory, '--source', source])
    const page = ingested.body.page as string
    await writeFile(
      join(directory, '.leon', 'knowledge', ...page.split('/')),
      `${await readFile(join(directory, '.leon', 'knowledge', ...page.split('/')), 'utf8')}\n[[concepts/inexistente]]\n`,
      'utf8',
    )

    const report = await run(['status', '--workspace', directory])

    expect(report.body).toMatchObject({
      ok: false,
      command: 'status',
      sources: 1,
      statuses: { pending_synthesis: 1 },
    })
    expect(report.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BROKEN_WIKILINK' }),
    ]))
  })
})
