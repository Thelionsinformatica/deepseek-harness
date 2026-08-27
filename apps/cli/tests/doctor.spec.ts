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
    checkedAt: '2026-08-27T12:00:00.000Z',
    path: async (path: string) => {
      const normalized = path.replaceAll('\\', '/')
      return normalized.endsWith('/package.json')
        || normalized.endsWith('/cordis.patch.yml')
        || normalized.endsWith('/lib/bin.js')
        ? file
        : directory
    },
    http: async (url: string) => url.endsWith('/api/tags')
      ? {
        status: 200,
        body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }, { name: 'ornith-1.5:9b' }] }),
      }
      : { status: 200, body: '<html><title>Leon — The Lions Informática</title></html>' },
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
        { id: 'ollama', label: 'Ollama', status: 'ok', summary: '2 modelo(s); Qwen e Ornith disponíveis' },
        { id: 'web', label: 'Leon Web', status: 'ok', summary: 'ativo em http://127.0.0.1:3080/' },
      ],
    })
    expect(JSON.stringify(report)).not.toMatch(/api[_-]?key|token|secret/iu)
    expect(formatDoctorReport(report)).toContain('Resumo: 8 OK, 0 aviso(s), 0 falha(s).')
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
      expect.objectContaining({ id: 'web', status: 'warning' }),
    ]))
  })

  it('fails when the expected Web port belongs to another application', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => url.endsWith('/api/tags')
        ? { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }] }) }
        : { status: 200, body: '<html><title>Outra aplicação</title></html>' },
    })

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ollama', status: 'warning' }),
      expect.objectContaining({ id: 'web', status: 'failed', summary: 'a porta 3080 respondeu, mas não foi identificada como Leon' }),
    ]))
  })
})
