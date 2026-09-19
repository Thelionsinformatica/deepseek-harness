import { describe, expect, it, vi } from 'vitest'
import { inspectUpstream, parseRemoteCommit } from './check-leon-upstream.js'

const CURRENT = '1111111111111111111111111111111111111111'
const CACHED = '2222222222222222222222222222222222222222'
const LIVE = '3333333333333333333333333333333333333333'

function gitFixture(cachedCommit: string | null, liveCommit = LIVE) {
  return vi.fn((args: string[]) => {
    const key = args.join(' ')
    if (key === 'remote get-url upstream') return { status: 0, stdout: 'https://example.invalid/upstream.git', stderr: '' }
    if (key === 'rev-parse HEAD') return { status: 0, stdout: CURRENT, stderr: '' }
    if (key === 'ls-remote --heads upstream refs/heads/master') {
      return { status: 0, stdout: `${liveCommit}\trefs/heads/master`, stderr: '' }
    }
    if (key === 'rev-parse --verify refs/remotes/upstream/master') {
      return cachedCommit === null
        ? { status: 1, stdout: '', stderr: 'missing' }
        : { status: 0, stdout: cachedCommit, stderr: '' }
    }
    throw new Error(`unexpected git call: ${key}`)
  })
}

describe('check-leon-upstream', () => {
  it('reports an available update without executing a mutating git command', () => {
    const runGit = gitFixture(CACHED)

    expect(inspectUpstream('upstream', 'master', runGit)).toMatchObject({
      cachedCommit: CACHED,
      status: 'update-available',
      upstreamCommit: LIVE,
    })
    expect(runGit.mock.calls.flatMap(call => call[0])).not.toContain('fetch')
  })

  it('reports an up-to-date cached upstream', () => {
    expect(inspectUpstream('upstream', 'master', gitFixture(LIVE)).status).toBe('up-to-date')
  })

  it('reports a missing comparison baseline', () => {
    expect(inspectUpstream('upstream', 'master', gitFixture(null)).status).toBe('baseline-missing')
  })

  it('rejects an ambiguous or malformed remote response', () => {
    expect(() => parseRemoteCommit('', 'refs/heads/master')).toThrow(/commit único/u)
    expect(() => parseRemoteCommit('not-a-hash\trefs/heads/master', 'refs/heads/master')).toThrow(/commit único/u)
  })
})
