/** Persisted audit outcomes through the real Loader, agent spine, filesystem and child provider. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as AgentSpine from '@deepseek-ai/dsh-agent-spine-demo'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import * as ToolReport from '@deepseek-ai/dsh-tool-subagent-report'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let ctx: Context | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.unstubAllEnvs()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('audit worker evidence snapshot', () => {
  it.each([false, true])('preserves evidence and denied writes with background=%s', async (background) => {
    root = await mkdtemp(join(tmpdir(), 'leon-audit-worker-snapshot-'))
    const fixtureRoot = root
    vi.stubEnv('DSH_AUDIT_FIXTURE_ROOT', join(root, 'sessions'))
    const source = join(root, 'source.txt')
    const target = join(root, 'untouched.txt')
    await writeFile(source, 'SOURCE EVIDENCE\n', { flag: 'wx' })
    await writeFile(target, 'ORIGINAL\n', { flag: 'wx' })
    ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent-spine-demo', AgentSpine],
      ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-tool-fs', ToolFs],
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['@deepseek-ai/dsh-subagent-spawn-in-process', Spawn],
      ['@deepseek-ai/dsh-tool-subagent', ToolSubagent],
      ['@deepseek-ai/dsh-tool-subagent-report', ToolReport],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected module: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const config = new URL('../audit-worker.cordis.snapshot.yml', import.meta.url)
    await ctx.loader.create({ name: 'cordis:include', config: { path: config.href } })
    await ctx.loader.await()
    const childModel = new MockAdapter([
      toolCallResponse('forbidden-write', 'write', { file_path: target, content: 'MUTATED' }),
      toolCallResponse('observed-read', 'read', { file_path: source }),
      textResponse('A finding still requiring parent verification.'),
    ])
    ctx.llm.registerAdapter(['fixture-worker'], childModel)
    ctx.llm.registerAdapter(['fixture-parent'], new MockAdapter([
      toolCallResponse('delegate-audit', 'subagent_audit', {
        description: 'Audit source', prompt: 'Inspect the source without changing files.',
        run_in_background: background, evidenceTools: [], toolFilter: { allow: ['write'] },
      }),
      textResponse('Awaiting or checking the audit.'),
      textResponse('Host evidence is not semantic approval.'),
    ]))
    const handle = await ctx.agents.create({
      sessionId: SessionId('audit-worker-parent'), meta: { cwd: root },
      agentOptions: { provider: 'fixture-parent', model: 'coordinator' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Audit this source.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await vi.waitFor(() => {
      expect(childModel.requests).toHaveLength(3)
      expect(JSON.stringify(handle.agent.session.events)).toContain(background
        ? 'SUBAGENT_EVIDENCE_OBSERVED' : 'findings remain unverified')
    })
    await handle.agent.whenIdle()
    await handle.dispose()
    // Registry disposal is observe-only; the persistence owner drains on disposal.
    await ctx.fiber.dispose()
    ctx = undefined
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL\n')
    expect(await readFile(source, 'utf8')).toBe('SOURCE EVIDENCE\n')
    const files = (await readdir(join(root, 'sessions'), { recursive: true })).filter(file => file.endsWith('.jsonl'))
    const contents = await Promise.all(files.map(file => readFile(join(fixtureRoot, 'sessions', file), 'utf8')))
    const child = contents.find(content => content.includes('"parentSession":"audit-worker-parent"'))
    expect(child).toBeDefined()
    const observed = {
      background,
      tools: childModel.requests[0]?.tools?.map(tool => tool.name),
      deniedWrite: childModel.requests.some(request => JSON.stringify(request.messages).includes('SUBAGENT_AUDIT_TOOL_DENIED')),
      readEvidence: child?.includes('SOURCE EVIDENCE'),
      evidencePolicyPersisted: child?.includes('"evidenceTools":["read"]'),
      impossibleReportInstruction: childModel.requests.some(request => JSON.stringify(request).includes('Deliver your result with the report tool')),
      originalPreserved: await readFile(target, 'utf8'),
    }
    expect(observed.deniedWrite).toBe(true)
    expect(observed.readEvidence).toBe(true)
    expect(observed.evidencePolicyPersisted).toBe(true)
    expect(observed.impossibleReportInstruction).toBe(false)
    expect(observed).toMatchSnapshot()
  })
})
