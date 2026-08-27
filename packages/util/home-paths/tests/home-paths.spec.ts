import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DSH_HOME_DISPLAY,
  DSH_CWD_ENV,
  DSH_DEFAULT_WORKSPACE_ENV,
  DSH_HOME_DIR_NAME,
  LEON_DEFAULT_WORKSPACE_ENV,
  LEON_WINDOWS_DEFAULT_WORKSPACE,
  canonicalizeWatchPath,
  defaultDshHome,
  dshHomeDisplay,
  dshHomePath,
  expandHomePath,
  resolveDefaultWorkspace,
  resolveDshHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(DSH_HOME_DIR_NAME).toBe('.dsh')
    expect(DEFAULT_DSH_HOME_DISPLAY).toBe('~/.dsh')
    expect(defaultDshHome()).toBe(join(homedir(), '.dsh'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.dsh')).toBe(join(homedir(), '.dsh'))
    expect(expandHomePath('~\\.dsh')).toBe(join(homedir(), '.dsh'))
    expect(expandHomePath('/tmp/.dsh')).toBe('/tmp/.dsh')
    expect(expandHomePath('~other/.dsh')).toBe('~other/.dsh')
  })

  it('resolves explicit path before DSH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveDshHome('/tmp/explicit-dsh', { DSH_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveDshHome(undefined, { DSH_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only DSH_HOME as unset', () => {
    expect(resolveDshHome(undefined, { DSH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { DSH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('resolves Leon workspace overrides in stable precedence order', () => {
    const cwd = resolve('workspace-base')
    const env = {
      [LEON_DEFAULT_WORKSPACE_ENV]: 'leon',
      [DSH_DEFAULT_WORKSPACE_ENV]: 'deployment',
      [DSH_CWD_ENV]: 'legacy',
    }

    expect(resolveDefaultWorkspace('explicit', env, cwd)).toBe(resolve(cwd, 'explicit'))
    expect(resolveDefaultWorkspace(undefined, env, cwd)).toBe(resolve(cwd, 'leon'))
    expect(resolveDefaultWorkspace(undefined, {
      ...env,
      [LEON_DEFAULT_WORKSPACE_ENV]: ' ',
    }, cwd)).toBe(resolve(cwd, 'deployment'))
    expect(resolveDefaultWorkspace(undefined, {
      [DSH_CWD_ENV]: 'legacy',
    }, cwd)).toBe(resolve(cwd, 'legacy'))
  })

  it('uses the Leon Windows root or invoking directory when no override exists', () => {
    const cwd = resolve('workspace-fallback')
    const expected = process.platform === 'win32'
      ? resolve(cwd, LEON_WINDOWS_DEFAULT_WORKSPACE)
      : cwd
    expect(resolveDefaultWorkspace(undefined, {}, cwd)).toBe(expected)
  })

  it('expands a configured workspace below the operating-system home', () => {
    expect(resolveDefaultWorkspace('~/leon-workspace', {}, '/unused'))
      .toBe(join(homedir(), 'leon-workspace'))
  })

  it('joins child segments onto the resolved DSH_HOME', () => {
    vi.stubEnv('DSH_HOME', '~/env-dsh')
    expect(dshHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.dsh')
    expect(dshHomeDisplay('/some/other/root')).toBe('$DSH_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
