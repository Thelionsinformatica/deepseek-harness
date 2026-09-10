import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Isolated regression lane: the default Windows suite excludes spawn.spec.ts.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    pool: 'forks',
    maxWorkers: 1,
    setupFiles: ['./scripts/test-invariants.ts'],
    include: ['packages/subprocess/subprocess-local/tests/spawn.spec.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
