import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [action, workspace, config] = process.argv.slice(2)
const options = JSON.parse(await readFile(config, 'utf8'))
if (options.mode === 'throw') throw new Error('fixture-runtime-error')
process.stdout.write(JSON.stringify({
  action, workspace, config, cwd: process.cwd(),
  environment: Object.keys(process.env).sort(),
  placeholder: process.env.LEON_COLLECTIVE_LOCAL_TOKEN,
  status: 'fixture-only',
}) + '\n')
if (options.mode === 'wait') {
  await writeFile(join(workspace, 'fixture-ready'), String(process.pid), { flag: 'wx' })
  process.on('SIGINT', () => process.exit(0))
  setInterval(() => {}, 1000)
} else {
  process.exitCode = options.code ?? 0
}
