import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as KnowledgeTools from '../src/index.ts'

const signal = new AbortController().signal
const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixtureScript(source: string): Promise<{ directory: string; scriptPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-knowledge-tool-'))
  temporaryDirectories.push(directory)
  const scriptPath = join(directory, 'helper.mjs')
  await writeFile(scriptPath, source, 'utf8')
  return { directory, scriptPath }
}

async function harness(scriptSource: string, config: Partial<KnowledgeTools.Config> = {}) {
  const fixture = await fixtureScript(scriptSource)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(KnowledgeTools, {
    scriptPath: fixture.scriptPath,
    ...config,
  })
  return { ctx, fiber, ...fixture }
}

let callCounter = 0

function execute(ctx: Context, name: string, args: unknown, executionSignal = signal) {
  callCounter += 1
  return ctx.tools.execute({
    callId: CallId(`knowledge-tool-${callCounter}`),
    name,
    arguments: args,
    signal: executionSignal,
  })
}

function textResult(result: Awaited<ReturnType<typeof execute>>): string {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

describe('knowledge target and argv validation', () => {
  it('derives Windows and POSIX workspaces only from an exact knowledge root', () => {
    expect(KnowledgeTools.knowledgeRootToWorkspace('D:\\SampleWorkspace\\.leon\\knowledge\\'))
      .toBe('D:\\SampleWorkspace')
    expect(KnowledgeTools.knowledgeRootToWorkspace('/srv/sampleworkspace/.leon/knowledge'))
      .toBe('/srv/sampleworkspace')
  })

  it.each([
    '.',
    'D:\\SampleWorkspace',
    'D:\\SampleWorkspace\\.leon',
    'D:\\SampleWorkspace\\.leon\\knowledge\\wiki',
    '\\\\server\\share\\.leon\\knowledge',
  ])('rejects ambiguous target %s', (path) => {
    expect(() => KnowledgeTools.knowledgeRootToWorkspace(path)).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_INVALID_TARGET' }),
    )
  })

  it('builds a fixed, normalized status and search argv tail', () => {
    expect(KnowledgeTools.buildKnowledgeArguments(
      'status',
      'D:\\SampleWorkspace\\.leon\\knowledge',
    )).toEqual(['status', '--workspace', 'D:\\SampleWorkspace'])
    expect(KnowledgeTools.buildKnowledgeArguments(
      'search',
      'D:\\SampleWorkspace\\.leon\\knowledge',
      '  decisões e projetos  ',
      5,
    )).toEqual([
      'search', '--workspace', 'D:\\SampleWorkspace',
      '--query', 'decisões e projetos', '--limit', '5',
    ])
  })

  it.each([
    ['', 8, 'KNOWLEDGE_INVALID_QUERY'],
    ['x'.repeat(513), 8, 'KNOWLEDGE_INVALID_QUERY'],
    ['valid', 0, 'KNOWLEDGE_INVALID_LIMIT'],
    ['valid', 21, 'KNOWLEDGE_INVALID_LIMIT'],
    ['valid', 1.5, 'KNOWLEDGE_INVALID_LIMIT'],
  ] as const)('rejects invalid query/limit before process execution', (query, limit, code) => {
    expect(() => KnowledgeTools.buildKnowledgeArguments(
      'search',
      'D:\\SampleWorkspace\\.leon\\knowledge',
      query,
      limit,
    )).toThrow(expect.objectContaining({ code }))
  })
})

describe('bounded helper execution', () => {
  it('registers both tools and passes only a fixed argv vector to Node', async () => {
    const { ctx, directory } = await harness(
      'process.stdout.write(JSON.stringify({ok:true, argv:process.argv.slice(2)}))',
    )
    const root = join(directory, '.leon', 'knowledge')

    const status = await execute(ctx, 'knowledge_status', { knowledge_root: root })
    expect(status.isError).toBe(false)
    expect(JSON.parse(textResult(status))).toEqual({
      ok: true,
      argv: ['status', '--workspace', directory],
    })

    const search = await execute(ctx, 'knowledge_search', {
      knowledge_root: root,
      query: '  arquitetura local  ',
      limit: 3,
    })
    expect(search.isError).toBe(false)
    expect(JSON.parse(textResult(search))).toEqual({
      ok: true,
      argv: ['search', '--workspace', directory, '--query', 'arquitetura local', '--limit', '3'],
    })
  })

  it('preserves structured helper failures and stable codes', async () => {
    const { ctx, directory } = await harness([
      'process.stdout.write(JSON.stringify({',
      '  ok:false, error:{code:"WORKSPACE_NOT_FOUND", message:"Workspace ausente"}',
      '}));',
      'process.exitCode=1;',
    ].join(''))
    const result = await execute(ctx, 'knowledge_status', {
      knowledge_root: join(directory, '.leon', 'knowledge'),
    })
    expect(result.isError).toBe(true)
    expect(textResult(result)).toContain('Workspace ausente')
    expect(result.error).toMatchObject({ info: { code: 'WORKSPACE_NOT_FOUND' } })
  })

  it('rejects malformed and over-budget output instead of exposing partial data', async () => {
    const malformed = await harness('process.stdout.write("not-json")')
    const malformedResult = await execute(malformed.ctx, 'knowledge_status', {
      knowledge_root: join(malformed.directory, '.leon', 'knowledge'),
    })
    expect(malformedResult.isError).toBe(true)
    expect(malformedResult.error).toMatchObject({ info: { code: 'KNOWLEDGE_HELPER_INVALID_OUTPUT' } })

    const overflow = await harness(
      'process.stdout.write(JSON.stringify({ok:true, value:"x".repeat(5000)}))',
      { maxOutputBytes: 128 },
    )
    const overflowResult = await execute(overflow.ctx, 'knowledge_status', {
      knowledge_root: join(overflow.directory, '.leon', 'knowledge'),
    })
    expect(overflowResult.isError).toBe(true)
    expect(overflowResult.error).toMatchObject({ info: { code: 'KNOWLEDGE_HELPER_OUTPUT_OVERFLOW' } })
  })

  it('removes both tools when the plugin fiber is disposed', async () => {
    const { ctx, fiber, directory } = await harness('process.stdout.write(JSON.stringify({ok:true}))')
    const root = join(directory, '.leon', 'knowledge')
    expect((await execute(ctx, 'knowledge_status', { knowledge_root: root })).isError).toBe(false)
    await fiber.dispose()
    expect((await execute(ctx, 'knowledge_status', { knowledge_root: root })).isError).toBe(true)
    expect((await execute(ctx, 'knowledge_search', { knowledge_root: root, query: 'x' })).isError).toBe(true)
  })
})

describe('plugin configuration', () => {
  it('fails at load for a missing or relative helper path', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ToolRuntime)

    await expect(ctx.plugin(KnowledgeTools, { scriptPath: 'helper.mjs' })).rejects.toThrow(
      'scriptPath must be an existing absolute file path',
    )
    await expect(ctx.plugin(KnowledgeTools, { scriptPath: join(tmpdir(), 'definitely-missing-helper.mjs') }))
      .rejects.toThrow('scriptPath must be an existing absolute file path')
  })

  it('has a loader-compatible named plugin surface and no default export', () => {
    expect('default' in KnowledgeTools).toBe(false)
    expect(KnowledgeTools.name).toBe('tool-knowledge-base')
    expect(KnowledgeTools.inject).toEqual(['tools', 'systemPrompt', 'subprocess'])
    expect(typeof KnowledgeTools.apply).toBe('function')
  })
})
