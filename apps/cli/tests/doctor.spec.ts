import { describe, expect, it, vi } from 'vitest'
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
    settings: () => ({ 'agent-default-model': { provider: 'ollama', model: 'qwen3.5:9b' } }),
    path: async (path: string) => {
      const normalized = path.replaceAll('\\', '/')
      return normalized.endsWith('/package.json')
        || normalized.endsWith('/cordis.patch.yml')
        || normalized.endsWith('/lib/bin.js')
        ? file
        : directory
    },
    http: async (url: string) => {
      if (url.endsWith('/api/version')) return { status: 200, body: JSON.stringify({ version: '0.1.0' }) }
      if (url.endsWith('/api/tags')) return {
        status: 200,
        body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }, { name: 'ornith-1.5:9b' }] }),
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
      overall: 'warning',
      checks: [
        { id: 'node', label: 'Node.js', status: 'ok', summary: '24.6.0' },
        { id: 'powershell', label: 'PowerShell', status: 'ok', summary: 'PowerShell 7.5.2' },
        { id: 'home', label: 'Dados do Leon', status: 'ok', summary: 'C:\\Users\\Test\\.dsh' },
        { id: 'workspace', label: 'Pasta de trabalho', status: 'ok', summary: 'E:\\computador' },
        { id: 'profile', label: 'Perfil', status: 'ok', summary: 'web instalado' },
        { id: 'build', label: 'Aplicativo compilado', status: 'ok', summary: 'versão 1.2.3' },
        { id: 'model-selection', label: 'Modelo configurado', status: 'ok', summary: 'Ollama: qwen3.5:9b', details: ['fonte: agent-default-model e llm-pi-ai.providers em settings.yaml'] },
        { id: 'model-health', label: 'Serviço Ollama', status: 'ok', summary: 'serviço respondeu com saúde válida; não comprova inferência' },
        { id: 'model-catalog', label: 'Catálogo Ollama', status: 'ok', summary: '2 modelo(s); modelo selecionado presente no catálogo' },
        { id: 'model-inference', label: 'Inferência', status: 'warning', summary: 'não executada; saúde e catálogo não validam geração, ferramentas ou desempenho da GPU' },
        { id: 'web', label: 'Leon Web', status: 'ok', summary: 'ativo em http://127.0.0.1:3080/' },
      ],
    })
    expect(JSON.stringify(report)).not.toMatch(/api[_-]?key|token|secret/iu)
    expect(formatDoctorReport(report)).toContain('Resumo: 10 OK, 1 aviso(s), 0 falha(s).')
  })

  it('accepts Windows PowerShell when PowerShell 7 is unavailable', async () => {
    const environment = healthyEnvironment()
    const command = vi.fn((executable: string) => executable === 'powershell.exe' ? 'Windows PowerShell 5.1' : undefined)
    const report = await collectDoctorReport(options, { ...environment, command })

    expect(command.mock.calls).toEqual([
      ['pwsh', ['--version']],
      ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']],
    ])
    expect(report.checks).toContainEqual({ id: 'powershell', label: 'PowerShell', status: 'ok', summary: 'Windows PowerShell 5.1' })
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
      expect.objectContaining({ id: 'model-health', status: 'warning' }),
      expect.objectContaining({ id: 'model-catalog', status: 'warning' }),
      expect.objectContaining({ id: 'web', status: 'warning' }),
    ]))
  })

  it('fails when the expected Web port belongs to another application', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3.5:9b' }] }) }
        return { status: 200, body: '<html><title>Outra aplicação</title></html>' }
      },
    })

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model-catalog', status: 'ok' }),
      expect.objectContaining({ id: 'web', status: 'failed', summary: 'a porta 3080 respondeu, mas não foi identificada como Leon' }),
    ]))
  })

  it('warns when the saved model is absent without requiring unrelated models', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      http: async (url: string) => {
        if (url.endsWith('/api/tags')) return {
          status: 200,
          body: JSON.stringify({ models: [{ name: 'ornith-1.5:9b' }, { name: 'qwen3.8-distill:9b-q8' }] }),
        }
        return { status: 200, body: '<html><title>Leon</title></html>' }
      },
    })

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'model-catalog',
      status: 'warning',
      summary: 'modelo selecionado ausente ou catálogo inválido: qwen3.5:9b',
    }))
  })

  it('checks the configured llama.cpp model through separate metadata endpoints only', async () => {
    const environment = healthyEnvironment()
    const http = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return { status: 200, body: '{"status":"ok"}' }
      if (url.endsWith('/v1/models')) return { status: 200, body: '{"data":[{"id":"compact-test"},{"id":"compact-test"}]}' }
      return environment.http(url)
    })
    const report = await collectDoctorReport(options, {
      ...environment, http,
      settings: () => ({
        'agent-default-model': { provider: 'llamacpp', model: 'compact-test' },
        'llm-pi-ai': { providers: {
          llamacpp: { baseURL: 'http://user:credential-secret@127.0.0.1:8096/v1/?api_key=credential-secret', headers: { Authorization: 'credential-secret' } },
          freellmapi: { baseURL: 'http://127.0.0.1:31415/v1' },
        } },
      }),
    })
    expect(http.mock.calls.map(([url]) => url).sort()).toEqual([
      'http://127.0.0.1:3080/', 'http://127.0.0.1:8096/health', 'http://127.0.0.1:8096/v1/models',
    ])
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model-selection', summary: 'llama.cpp: compact-test', status: 'ok' }),
      expect.objectContaining({ id: 'model-health', status: 'ok' }),
      expect.objectContaining({ id: 'model-catalog', status: 'ok', summary: '1 modelo(s); modelo selecionado presente no catálogo' }),
      expect.objectContaining({ id: 'model-inference', status: 'warning' }),
    ]))
    expect(JSON.stringify(report)).not.toContain('credential-secret')
  })

  it.each([
    { provider: 'freellmapi', model: 'auto' },
    { provider: 'google', model: 'remote-test' },
    { provider: 'deepseek', model: 'deepseek-flash' },
  ])('reports an external selection without contacting provider $provider', async ({ provider, model }) => {
    const environment = healthyEnvironment()
    const http = vi.fn(environment.http)
    const report = await collectDoctorReport(options, {
      ...environment, http, settings: () => ({ 'agent-default-model': { provider, model } }),
    })
    expect(http.mock.calls).toEqual([['http://127.0.0.1:3080/']])
    expect(report.checks).toContainEqual({
      id: 'model-selection', label: 'Modelo configurado', status: 'ok',
      summary: `modelo externo configurado: ${provider}/${model}; disponibilidade não consultada`,
    })
  })

  it('reports a genuinely absent model selection', async () => {
    const environment = healthyEnvironment()
    const http = vi.fn(environment.http)
    const report = await collectDoctorReport(options, { ...environment, http, settings: () => ({}) })
    expect(http.mock.calls).toEqual([['http://127.0.0.1:3080/']])
    expect(report.checks).toContainEqual({
      id: 'model-selection', label: 'Modelo configurado', status: 'warning',
      summary: 'seleção ausente em settings.yaml; nenhum provedor externo foi consultado',
    })
  })

  it('uses the explicitly saved Ollama model and endpoint instead of a historical 9B requirement', async () => {
    const environment = healthyEnvironment()
    const http = vi.fn(async (url: string) => url.endsWith('/api/tags')
      ? { status: 200, body: '{"models":[{"name":"tiny-local:2b"}]}' }
      : environment.http(url))
    const report = await collectDoctorReport(options, { ...environment, http,
      settings: () => ({ 'agent-default-model': { provider: 'ollama', model: 'tiny-local:2b' }, 'llm-pi-ai': { providers: { ollama: { baseURL: 'http://127.0.0.1:11439/v1' } } } }),
    })
    expect(http.mock.calls.map(([url]) => url).sort()).toEqual([
      'http://127.0.0.1:11439/api/tags', 'http://127.0.0.1:11439/api/version', 'http://127.0.0.1:3080/',
    ])
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'model-catalog', status: 'ok' }))
    expect(JSON.stringify(report)).not.toContain('9b')
  })

  it('keeps failed service health separate from a readable model catalogue', async () => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, { ...environment,
      http: async url => url.endsWith('/api/version') ? { status: 503, body: '' } : environment.http(url),
    })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model-health', status: 'warning' }),
      expect.objectContaining({ id: 'model-catalog', status: 'ok' }),
      expect.objectContaining({ id: 'model-inference', status: 'warning' }),
    ]))
  })

  it.each(['https://external.invalid/v1', 'file:///private', 'http://secret:private@invalid.invalid/v1', ''])('rejects a non-loopback or invalid local endpoint %s', async (baseURL) => {
    const environment = healthyEnvironment()
    const http = vi.fn(environment.http)
    const report = await collectDoctorReport(options, {
      ...environment, http,
      settings: () => ({ 'agent-default-model': { provider: 'llamacpp', model: 'test' }, 'llm-pi-ai': { providers: { llamacpp: { baseURL } } } }),
    })
    expect(http.mock.calls).toEqual([['http://127.0.0.1:3080/']])
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'model-selection', status: 'failed' }))
    expect(JSON.stringify(report)).not.toContain(baseURL || 'external.invalid')
  })

  it.each([
    { status: 503, body: 'credential-secret' },
    { status: 200, body: 'invalid credential-secret JSON' },
    { status: 200, body: '{"data":[{"id":"other-model"}]}' },
  ])('does not confuse a failing health or catalogue response with working inference', async (response) => {
    const environment = healthyEnvironment()
    const report = await collectDoctorReport(options, {
      ...environment,
      settings: () => ({ 'agent-default-model': { provider: 'llamacpp', model: 'test' }, 'llm-pi-ai': { providers: { llamacpp: { baseURL: 'http://127.0.0.1:8096/v1' } } } }),
      http: async url => url.includes(':8096/') ? response : environment.http(url),
    })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model-health', status: 'warning' }),
      expect.objectContaining({ id: 'model-catalog', status: 'warning' }),
      expect.objectContaining({ id: 'model-inference', status: 'warning' }),
    ]))
    expect(JSON.stringify(report)).not.toContain('credential-secret')
  })

  it.each(['ENOENT', 'EACCES', 'PARSE'])('reports unreadable settings without leaking parser diagnostics (%s)', async (code) => {
    const environment = healthyEnvironment()
    const http = vi.fn(environment.http)
    const report = await collectDoctorReport(options, { ...environment, http,
      settings: () => { throw Object.assign(new Error('credential-secret'), { code }) },
    })
    expect(http.mock.calls).toEqual([['http://127.0.0.1:3080/']])
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'model-selection', status: code === 'ENOENT' ? 'warning' : 'failed' }))
    expect(JSON.stringify(report)).not.toContain('credential-secret')
  })
})
