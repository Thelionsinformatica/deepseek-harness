/** Test-loader configuration, not part of the Host TypeScript program; selects portable POSIX-suite cases. */

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-invariants.ts'],
    include: ['packages/subprocess/subprocess-local/tests/{spawn,local,terminal,lifecycle-contract}.spec.ts'],
    testNamePattern: /terminate\(\) after the tree died|repeated terminate after exit|validates terminal allocation inputs|rejects unsafe foreground signals|settles an already-absent tree|rejects terminal allocation failures/,
    maxWorkers: 1,
    pool: 'forks',
    testTimeout: 20_000,
  },
})
