/** Build only the dashboard browser candidate in memory, outside the Host test type graph. */
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import dashboardConfig from '../../../packages/client/ui-work-dashboard/tsdown.config.ts'

const cwd = fileURLToPath(new URL('../../../packages/client/ui-work-dashboard/', import.meta.url))
// An unspecified build face is the preset's supported source-entry path.
const config = dashboardConfig({}).find(candidate => candidate.platform === 'browser')
if (config === undefined) throw new Error('Dashboard browser configuration is missing')
const bundles = await build({ ...config, cwd, config: false, write: false, clean: false,
  sourcemap: false, logLevel: 'silent', report: false })
try {
  const chunks = bundles.flatMap(bundle => bundle.chunks)
  const client = chunks.find(chunk => chunk.type === 'chunk' && chunk.fileName === 'client.js')
  if (client?.type !== 'chunk' || chunks.length !== 1) throw new Error('Expected one self-contained dashboard candidate')
  process.stdout.write(JSON.stringify({ code: client.code }))
} finally {
  for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
}
