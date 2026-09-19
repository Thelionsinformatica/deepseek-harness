import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export interface UpstreamState {
  branch: string
  cachedCommit: string | null
  currentCommit: string
  remote: string
  remoteUrl: string
  status: 'baseline-missing' | 'update-available' | 'up-to-date'
  upstreamCommit: string
}

interface GitResult {
  status: number | null
  stderr: string
  stdout: string
}

type RunGit = (args: string[]) => GitResult

function defaultRunGit(args: string[]): GitResult {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return {
    status: result.status,
    stderr: result.stderr.trim(),
    stdout: result.stdout.trim(),
  }
}

function requireGit(runGit: RunGit, args: string[], label: string): string {
  const result = runGit(args)
  if (result.status !== 0) {
    const detail = result.stderr.length > 0 ? `: ${result.stderr}` : ''
    throw new Error(`${label}${detail}`)
  }
  return result.stdout
}

/** Parse one exact branch response from `git ls-remote`. */
export function parseRemoteCommit(output: string, expectedRef: string): string {
  const matches = output
    .split(/\r?\n/u)
    .map(line => line.trim().split(/\s+/u))
    .filter(parts => parts.length === 2 && parts[1] === expectedRef)
  const commit = matches.length === 1 ? matches[0]?.[0] : undefined
  if (commit === undefined || !/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error(`a referência remota ${expectedRef} não retornou um commit único`)
  }
  return commit
}

/** Inspect the configured upstream without changing refs or working-tree files. */
export function inspectUpstream(
  remote = 'upstream',
  branch = 'master',
  runGit: RunGit = defaultRunGit,
): UpstreamState {
  const remoteUrl = requireGit(runGit, ['remote', 'get-url', remote], `remote ${remote} não configurado`)
  const currentCommit = requireGit(runGit, ['rev-parse', 'HEAD'], 'não foi possível ler o commit atual')
  const expectedRef = `refs/heads/${branch}`
  const upstreamCommit = parseRemoteCommit(
    requireGit(runGit, ['ls-remote', '--heads', remote, expectedRef], 'não foi possível consultar o upstream'),
    expectedRef,
  )
  const cached = runGit(['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`])
  const cachedCommit = cached.status === 0 && /^[0-9a-f]{40}$/u.test(cached.stdout) ? cached.stdout : null
  const status = cachedCommit === null
    ? 'baseline-missing'
    : cachedCommit === upstreamCommit
      ? 'up-to-date'
      : 'update-available'

  return { branch, cachedCommit, currentCommit, remote, remoteUrl, status, upstreamCommit }
}

function printState(state: UpstreamState, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(state, null, 2))
    return
  }
  console.log(`Leon upstream: ${state.remote}/${state.branch}`)
  console.log(`Origem consultada: ${state.remoteUrl}`)
  if (state.status === 'up-to-date') {
    console.log('Situação: nenhuma novidade detectada no projeto original.')
    return
  }
  if (state.status === 'update-available') {
    console.log('Situação: há uma nova versão upstream para análise manual.')
    console.log('Nenhum arquivo, referência Git ou configuração foi alterado.')
    return
  }
  console.log('Situação: o upstream respondeu, mas ainda não existe uma referência local de comparação.')
  console.log('Nenhum arquivo, referência Git ou configuração foi alterado.')
}

function optionValue(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} exige um valor`)
  return value
}

export function main(args = process.argv.slice(2)): number {
  try {
    const remote = optionValue(args, '--remote', 'upstream')
    const branch = optionValue(args, '--branch', 'master')
    printState(inspectUpstream(remote, branch), args.includes('--json'))
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Leon upstream: verificação falhou: ${message}`)
    return 1
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) process.exitCode = main()
