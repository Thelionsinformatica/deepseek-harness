import { constants, createReadStream } from 'node:fs'
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 20
const MAX_SEARCH_QUERY_CHARS = 512
const MAX_SEARCH_ENTRIES = 2_000
const MAX_SEARCH_FILE_BYTES = 1024 * 1024
const MAX_SEARCH_SCAN_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_OUTPUT_BYTES = 32 * 1024
const MAX_SEARCH_SNIPPET_CHARS = 360
const TEXT_EXTENSIONS = new Set([
  '.csv', '.html', '.json', '.md', '.rst', '.text', '.toml', '.tsv', '.txt', '.xml', '.yaml', '.yml',
])
const REQUIRED_DIRECTORIES = [
  'raw',
  'wiki/sources',
  'wiki/concepts',
  'wiki/entities',
  'wiki/comparisons',
  'wiki/syntheses',
]
const REQUIRED_FILES = ['schema.yml', 'index.md', 'log.md']

const SCHEMA = `version: 1
language: pt-BR
source_of_truth:
  raw: immutable
  wiki: derived
statuses:
  - pending_synthesis
  - active
  - stale
  - contested
required_source_fields:
  - title
  - type
  - source_id
  - raw_file
  - source_sha256
  - status
  - ingested_at
  - source_original
writes:
  raw: never
  wiki: grounded_only
  index: append_or_update
  log: append_only
`

const INDEX = `# Base de conhecimento do Leon

Esta base mantém as fontes originais separadas das sínteses produzidas pelo Leon.

## Fontes

`

const LOG = `# Log da base de conhecimento

`

class KnowledgeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function parseArguments(argv) {
  const [command, ...tokens] = argv
  const options = new Map()
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]
    const value = tokens[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new KnowledgeError('INVALID_ARGUMENTS', `Argumento inválido próximo de ${key ?? '(vazio)'}.`)
    }
    options.set(key.slice(2), value)
  }
  return { command, options }
}

function isContained(parent, target) {
  const pathFromParent = relative(parent, target)
  return pathFromParent === '' || (
    pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent)
  )
}

function requireContained(parent, target, code, message) {
  if (!isContained(parent, target)) throw new KnowledgeError(code, message)
}

function portablePath(value) {
  return value.split(sep).join('/')
}

function cleanTitle(value) {
  const title = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (title === '') throw new KnowledgeError('INVALID_TITLE', 'O título da fonte está vazio.')
  return title
}

async function writeOnce(path, content) {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
}

async function workspaceContext(workspaceOption, create = false) {
  const requestedWorkspace = resolve(workspaceOption ?? process.cwd())
  let workspace
  try {
    workspace = await realpath(requestedWorkspace)
  } catch {
    throw new KnowledgeError('WORKSPACE_NOT_FOUND', `Workspace não encontrado: ${requestedWorkspace}`)
  }
  const workspaceStats = await stat(workspace)
  if (!workspaceStats.isDirectory()) {
    throw new KnowledgeError('WORKSPACE_NOT_DIRECTORY', `O workspace não é uma pasta: ${workspace}`)
  }

  const root = join(workspace, '.leon', 'knowledge')
  if (create) await mkdir(root, { recursive: true, mode: 0o700 })
  let rootReal
  try {
    rootReal = await realpath(root)
  } catch {
    throw new KnowledgeError('KNOWLEDGE_NOT_INITIALIZED', 'A base ainda não foi inicializada neste workspace.')
  }
  requireContained(
    workspace,
    rootReal,
    'KNOWLEDGE_PATH_ESCAPE',
    'A pasta .leon/knowledge aponta para fora do workspace.',
  )
  return { workspace, root: rootReal }
}

async function initialize(workspaceOption) {
  const context = await workspaceContext(workspaceOption, true)
  for (const directory of REQUIRED_DIRECTORIES) {
    await mkdir(join(context.root, ...directory.split('/')), { recursive: true, mode: 0o700 })
  }
  const created = []
  if (await writeOnce(join(context.root, 'schema.yml'), SCHEMA)) created.push('schema.yml')
  if (await writeOnce(join(context.root, 'index.md'), INDEX)) created.push('index.md')
  if (await writeOnce(join(context.root, 'log.md'), LOG)) created.push('log.md')
  return { ok: true, command: 'init', root: context.root, created }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function rejectSensitiveSource(path) {
  const filename = basename(path).toLowerCase()
  if (filename === '.env' || filename.includes('credential') || filename.includes('secret')) {
    throw new KnowledgeError('SENSITIVE_SOURCE', 'A fonte parece conter credenciais e não pode entrar na base.')
  }
  if (!TEXT_EXTENSIONS.has(extname(filename))) return
  const sample = (await readFile(path)).subarray(0, 2 * 1024 * 1024).toString('utf8')
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bsk-[0-9A-Za-z_-]{20,}\b/,
    /(?:api[_ -]?key|token|password|senha)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+]{16,}/i,
  ]
  if (patterns.some(pattern => pattern.test(sample))) {
    throw new KnowledgeError('SENSITIVE_SOURCE', 'A fonte parece conter uma chave, token ou senha.')
  }
}

function sourcePage({ title, id, rawFile, hash, ingestedAt, original }) {
  return `---
title: ${JSON.stringify(title)}
type: source
source_id: ${id}
raw_file: ${JSON.stringify(rawFile)}
source_sha256: ${hash}
status: pending_synthesis
ingested_at: ${JSON.stringify(ingestedAt)}
source_original: ${JSON.stringify(original)}
---

# ${title}

## Resumo

Pendente de síntese.

## Fatos principais

- Pendente de síntese.

## Relações

- Pendente de síntese.

## Citações da fonte

- Fonte original preservada em \`${rawFile}\` (SHA-256: \`${hash}\`).
`
}

async function ingest(workspaceOption, sourceOption, titleOption) {
  if (sourceOption === undefined) {
    throw new KnowledgeError('SOURCE_REQUIRED', 'Informe --source <arquivo>.')
  }
  await initialize(workspaceOption)
  const context = await workspaceContext(workspaceOption)
  const requestedSource = resolve(context.workspace, sourceOption)
  let source
  try {
    source = await realpath(requestedSource)
  } catch {
    throw new KnowledgeError('SOURCE_NOT_FOUND', `Fonte não encontrada: ${requestedSource}`)
  }
  requireContained(
    context.workspace,
    source,
    'SOURCE_OUTSIDE_WORKSPACE',
    'A fonte precisa estar dentro do workspace atual.',
  )
  if (isContained(context.root, source)) {
    throw new KnowledgeError('GENERATED_SOURCE', 'Uma fonte gerada dentro de .leon/knowledge não pode ser ingerida.')
  }
  const sourceStats = await lstat(source)
  if (!sourceStats.isFile()) throw new KnowledgeError('SOURCE_NOT_FILE', 'A fonte precisa ser um arquivo regular.')
  if (sourceStats.size > MAX_SOURCE_BYTES) {
    throw new KnowledgeError('SOURCE_TOO_LARGE', 'A fonte excede o limite de 25 MB da V1.')
  }
  await rejectSensitiveSource(source)

  const hash = await sha256(source)
  const id = hash.slice(0, 24)
  const extension = extname(source).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12)
  const rawName = `${hash}${extension}`
  const rawAbsolute = join(context.root, 'raw', rawName)
  const rawRelative = `raw/${rawName}`
  const pageAbsolute = join(context.root, 'wiki', 'sources', `${id}.md`)
  const pageRelative = `wiki/sources/${id}.md`
  const title = cleanTitle(titleOption ?? basename(source, extname(source)))
  const original = portablePath(relative(context.workspace, source))

  let copied = false
  try {
    await copyFile(source, rawAbsolute, constants.COPYFILE_EXCL)
    copied = true
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    if (await sha256(rawAbsolute) !== hash) {
      throw new KnowledgeError('RAW_HASH_COLLISION', `A cópia bruta existente não corresponde ao hash ${hash}.`)
    }
  }

  const ingestedAt = new Date().toISOString()
  const pageCreated = await writeOnce(pageAbsolute, sourcePage({
    title,
    id,
    rawFile: rawRelative,
    hash,
    ingestedAt,
    original,
  }))
  if (pageCreated) {
    await appendFile(
      join(context.root, 'index.md'),
      `- [[sources/${id}|${title}]] — \`pending_synthesis\`\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    await appendFile(
      join(context.root, 'log.md'),
      `- ${ingestedAt} — ingestão \`${id}\` de \`${original}\` (SHA-256 \`${hash}\`).\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  return {
    ok: true,
    command: 'ingest',
    duplicate: !pageCreated,
    copied,
    sourceId: id,
    sourceSha256: hash,
    rawFile: rawRelative,
    page: pageRelative,
    status: 'pending_synthesis',
  }
}

function frontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return new Map()
  const values = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    try {
      values.set(key, JSON.parse(raw))
    } catch {
      values.set(key, raw)
    }
  }
  return values
}

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

function searchLimit(value) {
  if (value === undefined) return DEFAULT_SEARCH_LIMIT
  if (!/^[1-9]\d*$/.test(value)) {
    throw new KnowledgeError('INVALID_SEARCH_LIMIT', `--limit precisa ser um inteiro entre 1 e ${MAX_SEARCH_LIMIT}.`)
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_SEARCH_LIMIT) {
    throw new KnowledgeError('INVALID_SEARCH_LIMIT', `--limit precisa ser um inteiro entre 1 e ${MAX_SEARCH_LIMIT}.`)
  }
  return limit
}

function searchQuery(value) {
  const query = value?.replace(/\s+/g, ' ').trim()
  if (query === undefined || query === '') {
    throw new KnowledgeError('SEARCH_QUERY_REQUIRED', 'Informe --query <texto>.')
  }
  if (query.length > MAX_SEARCH_QUERY_CHARS) {
    throw new KnowledgeError(
      'SEARCH_QUERY_TOO_LONG',
      `A consulta excede o limite de ${MAX_SEARCH_QUERY_CHARS} caracteres.`,
    )
  }
  return query
}

function normalizedSearchText(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

const SEARCH_STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e',
  'em', 'eu', 'ja', 'leon', 'me', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou',
  'para', 'por', 'que', 'se', 'sem', 'sobre', 'um', 'uma', 'voce',
])

function queryTerms(query) {
  const normalized = normalizedSearchText(query)
  const candidates = normalized.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean)
  return {
    normalized,
    tokens: [...new Set(candidates.filter(token => (
      !SEARCH_STOP_WORDS.has(token)
      && (token.length >= 2 || /^\d+$/u.test(token))
    )))],
  }
}

function searchScore(path, content, terms) {
  const normalizedPath = normalizedSearchText(path)
  const normalizedContent = normalizedSearchText(content)
  let score = 0
  if (normalizedPath.includes(terms.normalized)) score += 240
  if (normalizedContent.includes(terms.normalized)) score += 120
  for (const token of terms.tokens) {
    if (normalizedPath.includes(token)) score += 24
    if (normalizedContent.includes(token)) score += 12
  }
  return score
}

function searchSnippet(content, terms) {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact === '') return ''
  const normalized = normalizedSearchText(compact)
  const needles = [terms.normalized, ...terms.tokens]
  let match = -1
  for (const needle of needles) {
    const candidate = normalized.indexOf(needle)
    if (candidate !== -1 && (match === -1 || candidate < match)) match = candidate
  }
  const center = match === -1 ? 0 : match
  const start = Math.max(0, center - Math.floor(MAX_SEARCH_SNIPPET_CHARS / 3))
  const end = Math.min(compact.length, start + MAX_SEARCH_SNIPPET_CHARS)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

function searchTitle(content, path) {
  const title = frontmatter(content).get('title')
  if (typeof title === 'string' && title.trim() !== '') return title.replace(/\s+/g, ' ').trim().slice(0, 160)
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]
  return (heading ?? basename(path, '.md')).replace(/\s+/g, ' ').trim().slice(0, 160)
}

async function boundedMarkdownFiles(root) {
  const files = []
  const directories = [root]
  let entries = 0
  let truncated = false

  while (directories.length > 0 && !truncated) {
    const directory = directories.shift()
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of children) {
      entries += 1
      if (entries > MAX_SEARCH_ENTRIES) {
        truncated = true
        break
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path)
    }
  }

  return { files, entries: Math.min(entries, MAX_SEARCH_ENTRIES), truncated }
}

async function canonicalSearchRoot(root, expectedRelative) {
  let canonical
  try {
    canonical = await realpath(join(root, ...expectedRelative.split('/')))
  } catch {
    throw new KnowledgeError('KNOWLEDGE_SEARCH_PATH_MISSING', `Caminho obrigatório ausente: ${expectedRelative}.`)
  }
  requireContained(
    root,
    canonical,
    'KNOWLEDGE_SEARCH_PATH_ESCAPE',
    `O caminho ${expectedRelative} aponta para fora da base de conhecimento.`,
  )
  if (portablePath(relative(root, canonical)) !== expectedRelative) {
    throw new KnowledgeError(
      'KNOWLEDGE_SEARCH_PATH_ESCAPE',
      `O caminho ${expectedRelative} aponta para outra área da base de conhecimento.`,
    )
  }
  return canonical
}

async function readSearchFile(context, path, allowedRoot, remainingBytes) {
  let canonical
  try {
    canonical = await realpath(path)
  } catch {
    return { skipped: true, reason: 'missing' }
  }
  requireContained(
    allowedRoot,
    canonical,
    'KNOWLEDGE_SEARCH_PATH_ESCAPE',
    'Um arquivo de busca aponta para fora da área documental permitida.',
  )
  const handle = await open(canonical, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) return { skipped: true, reason: 'not-file' }
    if (metadata.size > MAX_SEARCH_FILE_BYTES) {
      return { skipped: true, reason: 'file-byte-limit', bytes: metadata.size }
    }
    if (metadata.size > remainingBytes) {
      return { skipped: true, reason: 'scan-byte-limit', bytes: metadata.size }
    }
    const buffer = Buffer.alloc(metadata.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      skipped: false,
      bytes: offset,
      content: buffer.subarray(0, offset).toString('utf8'),
      path: portablePath(relative(context.workspace, canonical)),
      searchPath: portablePath(relative(context.root, canonical)),
    }
  } finally {
    await handle.close()
  }
}

async function search(workspaceOption, queryOption, limitOption) {
  const context = await workspaceContext(workspaceOption)
  const query = searchQuery(queryOption)
  const limit = searchLimit(limitOption)
  const terms = queryTerms(query)
  const index = await canonicalSearchRoot(context.root, 'index.md')
  const wiki = await canonicalSearchRoot(context.root, 'wiki')
  const discovered = await boundedMarkdownFiles(wiki)
  const candidates = [
    { path: index, allowedRoot: context.root },
    ...discovered.files.map(path => ({ path, allowedRoot: wiki })),
  ]
  const matches = []
  let scannedBytes = 0
  let scannedFiles = 0
  let skippedFiles = 0

  for (const candidate of candidates) {
    const file = await readSearchFile(
      context,
      candidate.path,
      candidate.allowedRoot,
      MAX_SEARCH_SCAN_BYTES - scannedBytes,
    )
    if (file.skipped) {
      skippedFiles += 1
      continue
    }
    scannedBytes += file.bytes
    scannedFiles += 1
    const score = searchScore(file.searchPath, file.content, terms)
    if (score === 0) continue
    const status = frontmatter(file.content).get('status')
    matches.push({
      path: file.path,
      title: searchTitle(file.content, file.path),
      ...(typeof status === 'string' ? { status } : {}),
      score,
      snippet: searchSnippet(file.content, terms),
    })
  }

  matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
  const results = []
  let outputBytes = 2
  for (const match of matches) {
    if (results.length >= limit) break
    const bytes = Buffer.byteLength(JSON.stringify(match), 'utf8') + (results.length === 0 ? 0 : 1)
    if (outputBytes + bytes > MAX_SEARCH_OUTPUT_BYTES) continue
    results.push(match)
    outputBytes += bytes
  }

  return {
    ok: true,
    command: 'search',
    query,
    limit,
    results,
    omittedMatches: matches.length - results.length,
    scan: {
      files: scannedFiles,
      bytes: scannedBytes,
      skippedFiles,
      discoveryTruncated: discovered.truncated,
    },
    limits: {
      maxResults: MAX_SEARCH_LIMIT,
      maxEntries: MAX_SEARCH_ENTRIES,
      maxFileBytes: MAX_SEARCH_FILE_BYTES,
      maxScanBytes: MAX_SEARCH_SCAN_BYTES,
      maxOutputBytes: MAX_SEARCH_OUTPUT_BYTES,
    },
  }
}

async function lint(workspaceOption) {
  let context
  try {
    context = await workspaceContext(workspaceOption)
  } catch (error) {
    if (error instanceof KnowledgeError && error.code === 'KNOWLEDGE_NOT_INITIALIZED') {
      return { ok: false, command: 'lint', issues: [{ code: error.code, path: '.leon/knowledge', message: error.message }] }
    }
    throw error
  }
  const issues = []
  for (const directory of REQUIRED_DIRECTORIES) {
    try {
      if (!(await stat(join(context.root, ...directory.split('/')))).isDirectory()) throw new Error()
    } catch {
      issues.push({ code: 'MISSING_DIRECTORY', path: directory, message: 'Diretório obrigatório ausente.' })
    }
  }
  for (const file of REQUIRED_FILES) {
    try {
      if (!(await stat(join(context.root, file))).isFile()) throw new Error()
    } catch {
      issues.push({ code: 'MISSING_FILE', path: file, message: 'Arquivo obrigatório ausente.' })
    }
  }

  const index = await readFile(join(context.root, 'index.md'), 'utf8').catch(() => '')
  const log = await readFile(join(context.root, 'log.md'), 'utf8').catch(() => '')
  const sourceDirectory = join(context.root, 'wiki', 'sources')
  let pages = []
  try {
    pages = (await readdir(sourceDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(sourceDirectory, entry.name))
  } catch {}

  for (const page of pages) {
    const content = await readFile(page, 'utf8')
    const fields = frontmatter(content)
    const pagePath = portablePath(relative(context.root, page))
    for (const field of ['title', 'type', 'source_id', 'raw_file', 'source_sha256', 'status', 'ingested_at', 'source_original']) {
      if (!fields.has(field)) issues.push({ code: 'MISSING_FIELD', path: pagePath, message: `Campo obrigatório ausente: ${field}.` })
    }
    const id = fields.get('source_id')
    const hash = fields.get('source_sha256')
    const rawFile = fields.get('raw_file')
    if (typeof id === 'string' && !index.includes(`[[sources/${id}|`)) {
      issues.push({ code: 'INDEX_ENTRY_MISSING', path: pagePath, message: `Fonte ${id} ausente do índice.` })
    }
    if (typeof id === 'string' && !log.includes(`\`${id}\``)) {
      issues.push({ code: 'LOG_ENTRY_MISSING', path: pagePath, message: `Fonte ${id} ausente do log.` })
    }
    if (typeof rawFile === 'string' && typeof hash === 'string') {
      const rawAbsolute = resolve(context.root, ...rawFile.split('/'))
      if (!isContained(join(context.root, 'raw'), rawAbsolute)) {
        issues.push({ code: 'RAW_PATH_ESCAPE', path: pagePath, message: 'raw_file aponta para fora de raw/.' })
      } else {
        try {
          if (await sha256(rawAbsolute) !== hash) {
            issues.push({ code: 'RAW_HASH_MISMATCH', path: rawFile, message: 'A fonte bruta foi alterada após a ingestão.' })
          }
        } catch {
          issues.push({ code: 'RAW_FILE_MISSING', path: rawFile, message: 'A fonte bruta não existe.' })
        }
      }
    }
  }

  const wikiRoot = join(context.root, 'wiki')
  for (const markdown of [join(context.root, 'index.md'), ...await markdownFiles(wikiRoot).catch(() => [])]) {
    const content = await readFile(markdown, 'utf8').catch(() => '')
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const target = resolve(wikiRoot, `${match[1]}.md`)
      if (!isContained(wikiRoot, target)) {
        issues.push({ code: 'WIKILINK_PATH_ESCAPE', path: portablePath(relative(context.root, markdown)), message: `Link inválido: ${match[0]}.` })
        continue
      }
      try {
        if (!(await stat(target)).isFile()) throw new Error()
      } catch {
        issues.push({ code: 'BROKEN_WIKILINK', path: portablePath(relative(context.root, markdown)), message: `Destino ausente: ${match[1]}.` })
      }
    }
  }

  return { ok: issues.length === 0, command: 'lint', root: context.root, sources: pages.length, issues }
}

async function status(workspaceOption) {
  const report = await lint(workspaceOption)
  if (!('root' in report)) return { ...report, command: 'status' }
  const statuses = {}
  const sourceDirectory = join(report.root, 'wiki', 'sources')
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const state = frontmatter(await readFile(join(sourceDirectory, entry.name), 'utf8')).get('status')
    if (typeof state === 'string') statuses[state] = (statuses[state] ?? 0) + 1
  }
  return { ok: report.ok, command: 'status', root: report.root, sources: report.sources, statuses, issues: report.issues }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  const workspace = options.get('workspace')
  if (command === 'init') return initialize(workspace)
  if (command === 'ingest') return ingest(workspace, options.get('source'), options.get('title'))
  if (command === 'search') return search(workspace, options.get('query'), options.get('limit'))
  if (command === 'lint') return lint(workspace)
  if (command === 'status') return status(workspace)
  throw new KnowledgeError('UNKNOWN_COMMAND', 'Use init, ingest, search, status ou lint.')
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`)
} catch (error) {
  const code = error instanceof KnowledgeError ? error.code : 'UNEXPECTED_ERROR'
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message: error.message } })}\n`)
  process.exitCode = 1
}
