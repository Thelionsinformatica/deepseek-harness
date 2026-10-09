import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i
const DEFAULT_SESSION = 'leon'
const DEFAULT_DEPTH = 8
const DEFAULT_MAX_CHARS = 12_000
const MAX_PROCESS_OUTPUT = 2 * 1024 * 1024

class BrowserContextError extends Error {
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
      throw new BrowserContextError('INVALID_ARGUMENTS', `Argumento inválido próximo de ${key ?? '(vazio)'}.`)
    }
    options.set(key.slice(2), value)
  }
  return { command, options }
}

function integerOption(options, name, fallback, minimum, maximum) {
  const raw = options.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BrowserContextError(
      'INVALID_ARGUMENTS',
      `--${name} deve ser um inteiro entre ${String(minimum)} e ${String(maximum)}.`,
    )
  }
  return value
}

function sessionOption(options) {
  const session = options.get('session') ?? DEFAULT_SESSION
  if (!SESSION_PATTERN.test(session)) {
    throw new BrowserContextError('INVALID_SESSION', 'O nome da sessão contém caracteres inválidos.')
  }
  return session
}

function safeChildEnvironment() {
  const environment = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key)) environment[key] = value
  }
  environment.NO_UPDATE_NOTIFIER = '1'
  return environment
}

function runtimePaths() {
  const nodePath = process.env.DSH_NODE
  const cliPath = process.env.DSH_PLAYWRIGHT_CLI
  if (nodePath === undefined || nodePath === '' || cliPath === undefined || cliPath === '') {
    throw new BrowserContextError(
      'PLAYWRIGHT_UNAVAILABLE',
      'O runtime do navegador não está disponível nesta composição do Leon.',
    )
  }
  return { nodePath, cliPath }
}

async function runCli(args, session) {
  const { nodePath, cliPath } = runtimePaths()
  const argv = [cliPath, ...(session === undefined ? [] : [`-s=${session}`]), ...args]
  try {
    const result = await execFileAsync(nodePath, argv, {
      encoding: 'utf8',
      env: safeChildEnvironment(),
      maxBuffer: MAX_PROCESS_OUTPUT,
      windowsHide: true,
    })
    return result.stdout.trimEnd()
  } catch (error) {
    const detail = typeof error?.stderr === 'string'
      ? error.stderr.split(/\r?\n/u).find(line => line.trim() !== '')?.trim()
      : undefined
    throw new BrowserContextError(
      'PLAYWRIGHT_COMMAND_FAILED',
      detail === undefined
        ? 'O navegador do Leon não respondeu à consulta de contexto.'
        : `O navegador do Leon não respondeu à consulta de contexto: ${detail.slice(0, 300)}`,
    )
  }
}

function parseJson(text, subject) {
  try {
    return JSON.parse(text)
  } catch {
    throw new BrowserContextError('PLAYWRIGHT_PROTOCOL_ERROR', `${subject} retornou JSON inválido.`)
  }
}

function parseTabs(text) {
  return text.split(/\r?\n/u).flatMap((line) => {
    const match = /^- (\d+): (?:(\(current\)) )?\[(.*)\]\((.*)\)$/u.exec(line.trim())
    if (match === null) return []
    return [{
      index: Number(match[1]),
      current: match[2] !== undefined,
      title: match[3],
      url: match[4],
    }]
  })
}

function routeOf(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : url
  } catch {
    return url
  }
}

function cachePath(session) {
  const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  return join(home, 'browser-context', `${session}.json`)
}

async function existingCacheKind(path) {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) {
      throw new BrowserContextError('CACHE_PATH_UNSAFE', 'O arquivo de contexto é um link simbólico e foi recusado.')
    }
    if (!stats.isFile()) {
      throw new BrowserContextError('CACHE_PATH_UNSAFE', 'O caminho do contexto não é um arquivo regular.')
    }
    return 'file'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function writeCache(session, record) {
  const path = cachePath(session)
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${session}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  })
  try {
    if (await existingCacheKind(path) === 'file') await unlink(path)
    await rename(temporary, path)
  } catch (error) {
    try { await unlink(temporary) } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }
  return path
}

async function inspect(options) {
  const session = sessionOption(options)
  const depth = integerOption(options, 'depth', DEFAULT_DEPTH, 1, 20)
  const maxChars = integerOption(options, 'max-chars', DEFAULT_MAX_CHARS, 1_000, 50_000)
  const inventory = parseJson(await runCli(['list', '--json']), 'A lista de sessões')
  const browser = Array.isArray(inventory.browsers)
    ? inventory.browsers.find(candidate => candidate?.name === session)
    : undefined
  if (browser === undefined || browser.status !== 'open' || browser.compatible === false) {
    const path = cachePath(session)
    const cachedKind = await existingCacheKind(path)
    if (cachedKind === 'file') await unlink(path)
    return {
      ok: true,
      command: 'inspect',
      available: false,
      session,
      reason: 'SESSION_UNAVAILABLE',
      discardedCachedContext: cachedKind === 'file',
      message: 'A sessão visível do navegador do Leon não está aberta.',
    }
  }

  const metadataText = await runCli([
    'eval',
    '() => ({ url: location.href, title: document.title, readyState: document.readyState })',
    '--raw',
  ], session)
  const metadata = parseJson(metadataText, 'Os metadados da aba ativa')
  if (typeof metadata.url !== 'string'
    || typeof metadata.title !== 'string'
    || !['loading', 'interactive', 'complete'].includes(metadata.readyState)) {
    throw new BrowserContextError('PLAYWRIGHT_PROTOCOL_ERROR', 'Os metadados da aba ativa estão incompletos.')
  }

  const tabsResult = parseJson(await runCli(['tab-list', '--json'], session), 'A lista de abas')
  const tabs = typeof tabsResult.result === 'string' ? parseTabs(tabsResult.result) : []
  const fullSnapshot = await runCli(['snapshot', `--depth=${String(depth)}`, '--raw'], session)
  const consoleResult = parseJson(
    await runCli(['console', 'warning', '--json'], session),
    'O resumo do console',
  )
  const snapshot = fullSnapshot.slice(0, maxChars)
  const record = {
    schemaVersion: 1,
    session,
    observedAt: new Date().toISOString(),
    snapshotId: createHash('sha256').update(fullSnapshot).digest('hex').slice(0, 16),
    page: {
      url: metadata.url,
      title: metadata.title,
      route: routeOf(metadata.url),
      readyState: metadata.readyState,
    },
    tabs,
    accessibilitySnapshot: snapshot,
    snapshotTruncated: snapshot.length < fullSnapshot.length,
    consoleSummary: typeof consoleResult.result === 'string' ? consoleResult.result.trim() : '',
  }
  const path = await writeCache(session, record)
  return { ok: true, command: 'inspect', available: true, cachePath: path, context: record }
}

async function status(options) {
  const session = sessionOption(options)
  const path = cachePath(session)
  if (await existingCacheKind(path) === 'missing') {
    return { ok: true, command: 'status', available: false, session, reason: 'NO_CACHED_CONTEXT' }
  }
  const context = parseJson(await readFile(path, 'utf8'), 'O cache de contexto')
  return { ok: true, command: 'status', available: true, cachePath: path, context }
}

async function clear(options) {
  const session = sessionOption(options)
  const path = cachePath(session)
  const kind = await existingCacheKind(path)
  if (kind === 'file') await unlink(path)
  return { ok: true, command: 'clear', session, removed: kind === 'file' }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  let result
  switch (command) {
    case 'inspect': result = await inspect(options); break
    case 'status': result = await status(options); break
    case 'clear': result = await clear(options); break
    default:
      throw new BrowserContextError(
        'INVALID_COMMAND',
        'Use inspect, status ou clear.',
      )
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  const code = error instanceof BrowserContextError ? error.code : 'UNEXPECTED_ERROR'
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`)
  process.exitCode = 1
})
