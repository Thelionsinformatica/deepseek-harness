import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import type { DoctorReport } from '../src/doctor.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))

describe('doctor local backend transcript', () => {
  it('reads saved llama.cpp selection through the assembled CLI without inference or state writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leon-doctor-snapshot-'))
    const requests: { method: string | undefined; url: string | undefined; authorization: string | undefined }[] = []
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization })
      if (request.url === '/health') response.end('{"status":"ok"}')
      else if (request.url === '/v1/models') response.end('{"data":[{"id":"compact-test"}]}')
      else if (request.url === '/') response.end('<title>Leon</title>')
      else { response.writeHead(404); response.end() }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing temporary server address')
      const document = JSON.stringify({
        'agent-default-model': { provider: 'llamacpp', model: 'compact-test' },
        'llm-pi-ai': { providers: {
          llamacpp: { baseURL: `http://127.0.0.1:${address.port}/v1`, headers: { Authorization: 'credential-not-for-health' } },
          freellmapi: { baseURL: 'http://127.0.0.1:1/v1' },
        } },
      })
      const settingsPath = join(dir, 'settings.yaml')
      await writeFile(settingsPath, document, { flag: 'wx' })
      const launch = resolveExampleLaunch({
        srcBin: join(root, 'apps/cli/src/bin.ts'), tsconfigPath: join(root, 'tsconfig.json'),
        configArgs: ['doctor', '--json', '--port', String(address.port)], env: { DSH_HOME: dir },
      })
      const inherited = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
        value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(name)))
      const result = await execa(launch.command, launch.args, {
        cwd: root, env: { ...inherited, ...launch.env }, extendEnv: false,
        input: '', timeout: 25_000, killSignal: 'SIGKILL', reject: false,
      })
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout) as DoctorReport
      expect(report.checks.filter(check => check.id.startsWith('model-'))).toMatchInlineSnapshot(`
        [
          {
            "details": [
              "fonte: agent-default-model e llm-pi-ai.providers em settings.yaml",
            ],
            "id": "model-selection",
            "label": "Modelo configurado",
            "status": "ok",
            "summary": "llama.cpp: compact-test",
          },
          {
            "id": "model-health",
            "label": "Serviço llama.cpp",
            "status": "ok",
            "summary": "serviço respondeu com saúde válida; não comprova inferência",
          },
          {
            "id": "model-catalog",
            "label": "Catálogo llama.cpp",
            "status": "ok",
            "summary": "1 modelo(s); modelo selecionado presente no catálogo",
          },
          {
            "id": "model-inference",
            "label": "Inferência",
            "status": "warning",
            "summary": "não executada; saúde e catálogo não validam geração, ferramentas ou desempenho da GPU",
          },
        ]
      `)
      expect(result.stdout).not.toContain('credential-not-for-health')
      expect(requests.sort((left, right) => String(left.url).localeCompare(String(right.url)))).toEqual([
        { method: 'GET', url: '/', authorization: undefined },
        { method: 'GET', url: '/health', authorization: undefined },
        { method: 'GET', url: '/v1/models', authorization: undefined },
      ])
      expect(await readFile(settingsPath, 'utf8')).toBe(document)
      expect(await readdir(dir)).toEqual(['settings.yaml'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
