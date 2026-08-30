import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

  it('searches only the bounded index and wiki surface with relative cited snippets', async () => {
    const directory = await workspace()
    await run(['init', '--workspace', directory])
    const root = join(directory, '.leon', 'knowledge')
    await writeFile(
      join(root, 'wiki', 'concepts', 'alpha.md'),
      '---\ntitle: "Conceito Alpha"\nstatus: active\n---\n\n# Alpha\n\nMARCADOR-CONSULTA-ALFA na VLAN 320.\n',
      'utf8',
    )
    await writeFile(
      join(root, 'wiki', 'entities', 'alpha.md'),
      '# Entidade Alpha\n\nA entidade confirma MARCADOR-CONSULTA-ALFA.\n',
      'utf8',
    )
    await writeFile(join(root, 'raw', 'excluded.md'), 'MARCADOR-RAW-EXCLUIDO', 'utf8')
    await writeFile(join(root, 'log.md'), 'MARCADOR-LOG-EXCLUIDO', 'utf8')
    await writeFile(join(root, 'schema.yml'), 'MARCADOR-SCHEMA-EXCLUIDO', 'utf8')

    const found = await run([
      'search',
      '--workspace',
      directory,
      '--query',
      'marcador consulta alfa',
      '--limit',
      '1',
    ])

    expect(found.exitCode).toBe(0)
    expect(found.body).toMatchObject({
      ok: true,
      command: 'search',
      query: 'marcador consulta alfa',
      limit: 1,
      omittedMatches: 1,
      results: [{
        path: '.leon/knowledge/wiki/concepts/alpha.md',
        title: 'Conceito Alpha',
        status: 'active',
      }],
      limits: {
        maxResults: 20,
        maxFileBytes: 1024 * 1024,
        maxScanBytes: 8 * 1024 * 1024,
        maxOutputBytes: 32 * 1024,
      },
    })
    expect(JSON.stringify(found.body.results)).not.toContain(directory)
    expect(JSON.stringify(found.body.results)).toContain('MARCADOR-CONSULTA-ALFA')

    for (const query of ['MARCADOR-RAW-EXCLUIDO', 'MARCADOR-LOG-EXCLUIDO', 'MARCADOR-SCHEMA-EXCLUIDO']) {
      const excluded = await run(['search', '--workspace', directory, '--query', query])
      expect(excluded.body).toMatchObject({ ok: true, results: [] })
    }
  })

  it('ignores common Portuguese words when ranking a natural-language recall query', async () => {
    const directory = await workspace()
    await run(['init', '--workspace', directory])
    const concepts = join(directory, '.leon', 'knowledge', 'wiki', 'concepts')
    await writeFile(
      join(concepts, 'generic.md'),
      '# Texto genérico\n\nO que já existe para o projeto e como usar.\n',
      'utf8',
    )
    await writeFile(
      join(concepts, 'learned.md'),
      '# Aprendizado confirmado\n\nLeon aprendeu que a rede usa VLAN 320.\n',
      'utf8',
    )

    const found = await run([
      'search',
      '--workspace',
      directory,
      '--query',
      'o que Leon já aprendeu',
    ])

    expect(found.exitCode).toBe(0)
    expect(found.body).toMatchObject({
      ok: true,
      results: [{ path: '.leon/knowledge/wiki/concepts/learned.md' }],
    })
    expect(JSON.stringify(found.body.results)).not.toContain('generic.md')
  })

  it('keeps searches inside one workspace and skips files beyond the byte budget', async () => {
    const alpha = await workspace()
    const beta = await workspace()
    await run(['init', '--workspace', alpha])
    await run(['init', '--workspace', beta])
    const alphaWiki = join(alpha, '.leon', 'knowledge', 'wiki', 'concepts')
    const betaWiki = join(beta, '.leon', 'knowledge', 'wiki', 'concepts')
    await writeFile(join(alphaWiki, 'alpha.md'), '# Alpha\n\nSOMENTE-WORKSPACE-ALPHA.\n', 'utf8')
    await writeFile(join(betaWiki, 'beta.md'), '# Beta\n\nSOMENTE-WORKSPACE-BETA.\n', 'utf8')
    await writeFile(
      join(alphaWiki, 'large.md'),
      `# Grande\n\nMARCADOR-ARQUIVO-GRANDE\n${'x'.repeat(1024 * 1024)}`,
      'utf8',
    )

    const crossWorkspace = await run([
      'search',
      '--workspace',
      alpha,
      '--query',
      'SOMENTE-WORKSPACE-BETA',
    ])
    const oversized = await run([
      'search',
      '--workspace',
      alpha,
      '--query',
      'MARCADOR-ARQUIVO-GRANDE',
    ])

    expect(crossWorkspace.body).toMatchObject({ ok: true, results: [] })
    expect(oversized.body).toMatchObject({
      ok: true,
      results: [],
      scan: { skippedFiles: 1 },
    })
  })

  it('rejects invalid search inputs and a wiki root redirected outside the knowledge base', async () => {
    const directory = await workspace()
    const outside = await workspace()
    await run(['init', '--workspace', directory])
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'outside.md'), '# Fora\n\nNÃO PODE SER CONSULTADO.\n', 'utf8')

    const missingQuery = await run(['search', '--workspace', directory])
    const invalidLimit = await run(['search', '--workspace', directory, '--query', 'teste', '--limit', '21'])
    expect(missingQuery).toMatchObject({
      exitCode: 1,
      body: { ok: false, error: { code: 'SEARCH_QUERY_REQUIRED' } },
    })
    expect(invalidLimit).toMatchObject({
      exitCode: 1,
      body: { ok: false, error: { code: 'INVALID_SEARCH_LIMIT' } },
    })

    const wiki = join(directory, '.leon', 'knowledge', 'wiki')
    await rm(wiki, { recursive: true, force: true })
    await symlink(outside, wiki, process.platform === 'win32' ? 'junction' : 'dir')
    const escaped = await run(['search', '--workspace', directory, '--query', 'consultado'])

    expect(escaped).toMatchObject({
      exitCode: 1,
      body: { ok: false, error: { code: 'KNOWLEDGE_SEARCH_PATH_ESCAPE' } },
    })
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
