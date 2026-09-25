/** Real Loader and durable JSONL journey with an in-process scripted model and fictitious records. */
import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { expect, it } from 'vitest'

it('projects a confirmed profile on greetings and replaces corrected or forgotten injections before the next request', async () => {
  const driver = fileURLToPath(new URL('./fixtures/personal-core-profile-driver.ts', import.meta.url))
  const result = await runLoaderSmoke({
    label: 'personal core profile', tempDirPrefix: 'dsh-personal-core-profile-',
    binScript: driver, libBinScript: driver,
    configPath: fileURLToPath(new URL('../personal-core-profile.cordis.snapshot.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url)),
    async inspect(cwd) {
      const root = join(cwd, 'sessions')
      const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
      expect(files).toHaveLength(1)
      const file = files[0]
      if (file === undefined) throw new Error('Expected the durable personal-profile session.')
      const log = await readFile(join(root, file), 'utf8')
      expect(log).toContain('O nome de trabalho do usuário é Pessoa Exemplo.')
      expect(log).toContain('O nome de trabalho do usuário é Pessoa Revisada.')
      expect(log).toContain('Personal memory context cleared.')
      expect(log).toContain('"op":"replace"')
    },
  })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toMatchSnapshot()
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
