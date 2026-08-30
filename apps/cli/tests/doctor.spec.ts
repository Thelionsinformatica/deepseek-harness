import { describe, expect, it } from 'vitest'
import {
  collectDoctorReport,
  formatDoctorReport,
  type DoctorOptions,
} from '../src/doctor.ts'

const options: DoctorOptions = { profile: 'web', port: 3080, json: false }

const directory = { kind: 'directory' as const, readable: true, writable: true }
const file = { kind: 'file' as const, readable: true, writable: true }

function healthyEnvironment() {
  return {
    platform: 'win32' as const,
    nodeVersion: '24.6.0',
    packageRoot: 'C:\\Leon',
    packageVersion: '1.2.3',
    home: 'C:\\Users\\Test\\.dsh',
    workspace: 'E:\\computador',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    freeLlmApiBaseUrl: 'http://127.0.0.1:31415',
    checkedAt: '2026-08-27T12:00:00.000Z',
    path: async (path: string) => {
      const normalized = path.replaceAll('\\', '/')
      return normalized.endsWith('/package.json')
        || normalized.endsWith('/cordis.patch.yml')
        || normalized.endsWith('/lib/bin.js')
        ? file
        : directory
    },
    http: async (url: string) => {
      if (url.endsWith('/api/tags')) return {
        status: 200,
        body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }, { name: 'ornith-1.5:9b' }] }),
      }
      if (url.endsWith('/readyz')) return {
        status: 200,
        body: JSON.stringify({ status: 'ok', ready_upstreams: 1 }),
      }
      return { status: 200, body: '<html><title>Leon — The Lions Informática</title></html>' }
    },
    command: () => 'PowerShell 7.5.2',
  }
}

describe('Leon doctor', () => {
  it('reports a healthy local-first installation without exposing credentials', async () => {
    const report = await collectDoctorReport(options, healthyEnvironment())

    expect(report).toEqual({
      schemaVersion: 1,
      product: 'Leon',
      version: '1.2.3',
      checkedAt: '2026-08-27T12:00:00.000Z',
      overall: 'ok',
      checks: [
        { id: 'node', label: 'Node.js', status: 'ok', summary: '24.6.0' },
        { id: 'powershell', label: 'PowerShell', status: 'ok', summary: 'PowerShell 7.5.2' },
        { id: 'home', label: 'Dados do Leon', status: 'ok', summary: 'C:\\Users\\Test\\.dsh' },
        { id: 'workspace', label: 'Pasta de trabalho', status: 'ok', summary: 'E:\\computador' },
        { id: 'profile', label: 'Perfil', status: 'ok', summary: 'web instalado' },
        { id: 'build', label: 'Aplicativo compilado', status: 'ok', summary: 'versão 1.2.3' },
        { id: 'ollama', label: 'Ollama', status: 'ok', summary: '2 modelo(s); Qwen automático disponível' },
        { id: 'freellmapi', label: 'Roteador externo', status: 'ok', summary: 'FreeLLMAPI ativo em http://127.0.0.1:31415; 1 provedor(es) pronto(s)' },
        { id: 'web', label: 'Leon Web', status: 'ok', summary: 'ativo em http://127.0.0.1:3080/' },
      ],
    })
    expect(JSON.stringify(report)).not.toMatch(/api[_-]?key|token|secret/iu)
    expect(formatDoctorReport(report)).toContain('Resumo: 9 OK, 0 aviso(s), 0 falha(s).')
  })

  it('distinguishes recoverable warnings from installation failures', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      nodeVersion: '22.18.0',
      path: async (path: string) => {
        const normalized = path.replaceAll('\\', '/')
        if (path === environment.workspace) return { kind: 'missing' as const, readable: false, writable: false }
        if (normalized.endsWith('/profiles/web')) return { kind: 'missing' as const, readable: false, writable: false }
        if (normalized.endsWith('/lib/bin.js')) return { kind: 'missing' as const, readable: false, writable: false }
        return directory
      },
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) throw new Error('connect ECONNREFUSED')
        throw new Error('connect ECONNREFUSED')
      },
      command: () => undefined,
    })

    expect(report.overall).toBe('failed')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node', status: 'failed' }),
      expect.objectContaining({ id: 'powershell', status: 'failed' }),
      expect.objectContaining({ id: 'workspace', status: 'failed' }),
      expect.objectContaining({ id: 'profile', status: 'warning' }),
      expect.objectContaining({ id: 'build', status: 'warning' }),
      expect.objectContaining({ id: 'ollama', status: 'warning' }),
      expect.objectContaining({ id: 'freellmapi', status: 'warning' }),
      expect.objectContaining({ id: 'web', status: 'warning' }),
    ]))
  })

  it('fails when the expected Web port belongs to another application', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }] }) }
        if (url.endsWith('/readyz')) return { status: 503, body: JSON.stringify({ status: 'unavailable', reason: 'no_upstreams_configured' }) }
        return { status: 200, body: '<html><title>Outra aplicação</title></html>' }
      },
    })

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ollama', status: 'ok' }),
      expect.objectContaining({ id: 'freellmapi', status: 'warning' }),
      expect.objectContaining({ id: 'web', status: 'failed', summary: 'a porta 3080 respondeu, mas não foi identificada como Leon' }),
    ]))
    const freeLlmApiCheck = report.checks.find(check => check.id === 'freellmapi')
    expect(freeLlmApiCheck?.summary).toContain('nenhum provedor configurado')
  })

  it('warns only when the automatic Qwen model is missing', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return {
          status: 200,
          body: JSON.stringify({ models: [{ name: 'ornith-1.5:9b' }, { name: 'qwen3.8-distill:9b-q8' }] }),
        }
        if (url.endsWith('/readyz')) return {
          status: 200,
          body: JSON.stringify({ status: 'ok', ready_upstreams: 1 }),
        }
        return { status: 200, body: '<html><title>Leon</title></html>' }
      },
    })

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'ollama',
      status: 'warning',
      details: ['modelo necessário ausente: qwen3.5:9b'],
    }))
  })

  it('fails closed when another service occupies the FreeLLMAPI endpoint', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }, { name: 'ornith-1.5:9b' }] }) }
        if (url.endsWith('/readyz')) return { status: 200, body: '<html><title>Outro serviço</title></html>' }
        return { status: 200, body: '<html><title>Leon</title></html>' }
      },
    })

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'freellmapi',
      status: 'failed',
      summary: 'a porta respondeu, mas não foi identificada como FreeLLMAPI',
    }))
  })

  it('fails closed when a 503 response imitates an unknown FreeLLMAPI reason', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }, { name: 'ornith-1.5:9b' }] }) }
        if (url.endsWith('/readyz')) return { status: 503, body: JSON.stringify({ status: 'unavailable', reason: 'something_else' }) }
        return { status: 200, body: '<html><title>Leon</title></html>' }
      },
    })

    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'freellmapi', status: 'failed' }))
  })
})
