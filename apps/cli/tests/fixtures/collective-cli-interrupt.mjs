import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Deliver a portable host interrupt only after the real child reports readiness.
const workspace = process.argv[process.argv.indexOf('--workspace') + 1]
const ready = setInterval(() => {
  if (existsSync(join(workspace, 'fixture-ready'))) {
    clearInterval(ready)
    process.emit('SIGINT')
  }
}, 50)
try {
  await import('../../src/bin.ts')
} finally {
  clearInterval(ready)
}
