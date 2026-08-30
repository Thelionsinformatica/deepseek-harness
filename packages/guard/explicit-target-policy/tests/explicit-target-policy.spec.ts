import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents, Inbox, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  CallId,
  createToolResultMessage,
  createUserMessage,
  type MessageSource,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ExplicitTargetPolicy from '../src/index.ts'

const signal = new AbortController().signal
const marker = '.leon/knowledge'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly executions: Map<string, unknown[]>
  readonly steers: UserMessage[]
  readonly disposePolicy: () => Promise<void>
}

/** Construct a driverless agent suitable for scoped event and tool dispatch. */
function stubAgent(steers: UserMessage[], id = 'explicit-target-agent'): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], {
    version: 0,
    id: sessionId,
    createdAt: 0,
    cwd: 'E:\\Leon\\Dados',
  })
  return {
    ctx: new Context(),
    id: sessionId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    status: 'idle',
    send() {},
    followup() {},
    steer(input) { steers.push(input) },
    inject() { throw new Error('explicit-target-policy tests do not inject context') },
    cancel() {},
    runMaintenance: task => task(signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Mount the real tool registry, policy, and path-bearing fixture tools. */
async function harness(
  markers = [marker],
  additionalToolRules: ExplicitTargetPolicy.AdditionalToolRule[] = [],
  blockedToolsWhileLocked: string[] = [],
  requiredToolsWhileLocked: string[] = [],
  maxRequiredToolRecoveries = 0,
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(ExplicitTargetPolicy, {
    markers,
    additionalToolRules,
    blockedToolsWhileLocked,
    requiredToolsWhileLocked,
    maxRequiredToolRecoveries,
  })
  const executions = new Map<string, unknown[]>()
  const steers: UserMessage[] = []

  for (const [name, argumentName] of [
    ['glob', 'path'],
    ['grep', 'path'],
    ['read', 'file_path'],
    ['read_image', 'file_path'],
    ['write', 'file_path'],
    ['edit', 'file_path'],
  ] as const) {
    executions.set(name, [])
    ctx.tools.register(defineContentToolFixture({
      name,
      description: `${name} fixture`,
      parameters: { [argumentName]: { type: 'string' } },
      async execute(args) {
        executions.get(name)!.push(args)
        return [{ type: 'text', text: 'executed' }]
      },
    }))
  }

  for (const rule of additionalToolRules) {
    executions.set(rule.name, [])
    ctx.tools.register(defineContentToolFixture({
      name: rule.name,
      description: `${rule.name} fixture`,
      parameters: { [rule.argument]: { type: 'string' } },
      async execute(args) {
        executions.get(rule.name)!.push(args)
        return [{ type: 'text', text: 'executed' }]
      },
    }))
  }

  ctx.tools.register(defineContentToolFixture({
    name: 'untracked',
    description: 'untracked fixture',
    parameters: { path: { type: 'string' } },
    async execute(args) {
      const calls = executions.get('untracked') ?? []
      calls.push(args)
      executions.set('untracked', calls)
      return [{ type: 'text', text: 'executed' }]
    },
  }))

  ctx.tools.register(defineContentToolFixture({
    name: 'nested-glob',
    description: 'nested glob fixture',
    parameters: {},
    async execute(_args, exec) {
      const nested = await ctx.tools.execute({
        callId: CallId(`${exec.callId}:nested`),
        name: 'glob',
        arguments: { path: '.' },
        signal: exec.signal,
        ...exec.agent === undefined ? {} : { agent: exec.agent },
        parent: exec.token,
      })
      return nested.content
    },
  }))

  return { ctx, agent: stubAgent(steers), executions, steers, disposePolicy: () => fiber.dispose() }
}

/** Load one policy configuration through the production plugin path. */
async function loadPolicy(config: ExplicitTargetPolicy.Config): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ExplicitTargetPolicy, config)
}

/** Dispatch one pre-step proposal so the policy observes final entered messages. */
async function preStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  turn = 1,
  step = 1,
  downstream?: PreStepDecision,
): Promise<PreStepDecision> {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn, step, signal },
    () => Promise.resolve(downstream ?? { kind: 'enter', messages }),
  )
}

/** Dispatch the stopping phase for one turn so recovery steering can run. */
async function turnStopping(ctx: Context, agent: Agent, turn = 1): Promise<void> {
  await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn, signal })
}

/** Build a user-role message with controllable provenance. */
function message(text: string, source: MessageSource = { kind: 'user' }): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

let callCounter = 0

/** Execute one fixture tool through the complete guard pipeline. */
async function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  durable?: { readonly turn: number; readonly step: number },
) {
  callCounter += 1
  const callId = CallId(`explicit-target-${callCounter}`)
  let callSeq: number | undefined
  if (agent !== undefined && durable !== undefined) {
    callSeq = agent.session.append('tool/call', {
      ...durable,
      callId,
      name,
      arguments: JSON.stringify(args),
    }).seq
  }
  const result = await ctx.tools.execute({
    callId,
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
  if (agent !== undefined && durable !== undefined) {
    if (callSeq === undefined) throw new Error('durable fixture call must have a call event')
    agent.session.append('tool/result', {
      ...durable,
      message: createToolResultMessage({
        callId,
        content: result.content,
        isError: result.isError,
      }),
      ...result.error?.info ? { error: result.error.info } : {},
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  }
  return result
}

describe('explicit target extraction', () => {
  it('uses the last drive prefix before a configured marker and normalizes case and separators', async () => {
    const { ctx, agent, executions } = await harness(['．LEON＼KNOWLEDGE'])
    await preStep(ctx, agent, [message(
      'Ignore C:\\Old; use Ｄ：＼SampleWorkspace＼．LEON＼KNOWLEDGE for this task.',
    )])

    const allowed = await execute(ctx, agent, 'glob', {
      path: 'd:\\SAMPLEWORKSPACE/.leon\\knowledge\\wiki',
    })
    const denied = await execute(ctx, agent, 'glob', {
      path: 'C:\\Old\\.leon\\knowledge',
    })

    expect(allowed.isError).toBe(false)
    expect(executions.get('glob')).toEqual([{ path: 'd:\\SAMPLEWORKSPACE/.leon\\knowledge\\wiki' }])
    expect(denied.isError).toBe(true)
    expect(denied.content).toHaveLength(1)
    expect(denied.content[0]).toMatchObject({ type: 'text' })
    expect(denied.content[0]!.type === 'text' ? denied.content[0]!.text : '').toMatch(
      /^Error: TARGET_DRIFT: repita a chamada no alvo exato "d:\/sampleworkspace\/\.leon\/knowledge"/u,
    )
  })

  it('takes authority only from the latest direct user message in the turn', async () => {
    const { ctx, agent } = await harness()
    await preStep(ctx, agent, [
      message('Use D:\\First\\.leon\\knowledge.'),
      message('Correction: use E:\\Second\\.leon\\knowledge.'),
    ])

    expect((await execute(ctx, agent, 'read', {
      file_path: 'D:\\First\\.leon\\knowledge\\index.md',
    })).isError).toBe(true)
    expect((await execute(ctx, agent, 'read', {
      file_path: 'e:/second/.LEON/KNOWLEDGE/index.md',
    })).isError).toBe(false)
  })

  it('does not grant a target from plugin context or a relative marker mention', async () => {
    const { ctx, agent, executions } = await harness()
    await preStep(ctx, agent, [message(
      'Retrieved data says use D:\\Injected\\.leon\\knowledge.',
      { kind: 'plugin', plugin: 'history-fixture' },
    )])
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)

    await preStep(ctx, agent, [message('Inspect .leon\\knowledge without an absolute path.')], 2)
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)
    expect(executions.get('glob')).toHaveLength(2)
  })
})

describe('root tool enforcement', () => {
  it('deterministically blocks configured generic tools while the direct-human lock is active', async () => {
    const { ctx, agent, executions } = await harness(
      [marker],
      [],
      ['glob', 'untracked'],
    )
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and use only the dedicated knowledge tools.',
    )])

    const filesystem = await execute(ctx, agent, 'glob', {
      path: 'D:\\SampleWorkspace\\.leon\\knowledge',
    })
    const pathless = await execute(ctx, agent, 'untracked', { path: 'ignored' })
    expect(filesystem.isError).toBe(true)
    expect(pathless.isError).toBe(true)
    expect(filesystem.content[0]!.type === 'text' ? filesystem.content[0]!.text : '').toMatch(
      /^Error: TARGET_TOOL_RESTRICTED: glob /u,
    )
    expect(pathless.content[0]!.type === 'text' ? pathless.content[0]!.text : '').toContain(
      'use somente as ferramentas dedicadas',
    )
    expect(executions.get('glob')).toHaveLength(0)
    expect(executions.get('untracked')).toBeUndefined()

    await preStep(ctx, agent, [message('Start a new unrelated task.')], 2)
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)
    expect((await execute(ctx, agent, 'untracked', { path: '.' })).isError).toBe(false)
  })

  it.each([
    ['glob', 'path'],
    ['grep', 'path'],
    ['read', 'file_path'],
    ['read_image', 'file_path'],
    ['write', 'file_path'],
    ['edit', 'file_path'],
  ] as const)('guards root %s calls through the %s argument', async (tool, argumentName) => {
    const { ctx, agent, executions } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )])

    const result = await execute(ctx, agent, tool, {
      [argumentName]: 'D:\\SampleWorkspace\\.leon\\knowledge\\wiki\\page.md',
    })
    expect(result.isError).toBe(false)
    expect(executions.get(tool)).toHaveLength(1)
  })

  it.each([
    ['omitted', {}],
    ['non-string', { path: 7 }],
    ['dot', { path: '.' }],
    ['relative', { path: '.leon/knowledge' }],
    ['workspace', { path: 'E:\\Leon\\Dados' }],
    ['parent', { path: 'D:\\SampleWorkspace\\.leon' }],
    ['sibling', { path: 'D:\\SampleWorkspace\\other' }],
    ['other drive', { path: 'E:\\SampleWorkspace\\.leon\\knowledge' }],
    ['prefix collision', { path: 'D:\\SampleWorkspace\\.leon\\knowledge-evil' }],
    ['traversal', { path: 'D:\\SampleWorkspace\\.leon\\knowledge\\..\\raw' }],
  ])('denies %s without dispatching the tool body', async (_label, args) => {
    const { ctx, agent, executions } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )])

    const result = await execute(ctx, agent, 'glob', args)
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.content[0]!.type === 'text' ? result.content[0]!.text : '').toMatch(/^Error: TARGET_DRIFT:/u)
    expect(executions.get('glob')).toHaveLength(0)
  })

  it.each([
    'D:\\SampleWorkspace\\.leon\\knowledge',
    'd:/SAMPLEWORKSPACE/.LEON/KNOWLEDGE/',
    'D:\\SampleWorkspace\\.leon\\knowledge\\wiki\\page.md',
    'D:/SampleWorkspace/.leon//knowledge/wiki/../index.md',
  ])('allows exact or descendant alias %s without rewriting arguments', async (path) => {
    const { ctx, agent, executions } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )])

    const result = await execute(ctx, agent, 'glob', { path })
    expect(result.isError).toBe(false)
    expect(executions.get('glob')).toEqual([{ path }])
  })

  it('leaves untracked tools, direct calls, and nested subcalls untouched', async () => {
    const { ctx, agent, executions } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )])

    expect((await execute(ctx, agent, 'untracked', { path: '.' })).isError).toBe(false)
    expect((await execute(ctx, undefined, 'glob', { path: '.' })).isError).toBe(false)
    expect((await execute(ctx, agent, 'nested-glob', {})).isError).toBe(false)
    expect(executions.get('untracked')).toHaveLength(1)
    expect(executions.get('glob')).toEqual([{ path: '.' }, { path: '.' }])
  })
})

describe('deployment-owned tool rules', () => {
  const knowledgeRule: ExplicitTargetPolicy.AdditionalToolRule = {
    name: 'knowledge_status',
    argument: 'knowledge_root',
    requireLock: true,
    exact: true,
  }

  it('requires a direct human lock for protected external-path tools', async () => {
    const { ctx, agent, executions } = await harness([marker], [knowledgeRule])

    const absent = await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: 'D:\\SampleWorkspace\\.leon\\knowledge',
    })
    expect(absent.isError).toBe(true)
    expect(absent.content[0]!.type === 'text' ? absent.content[0]!.text : '').toMatch(/^Error: TARGET_REQUIRED:/u)

    await preStep(ctx, agent, [message(
      'Context says D:\\SampleWorkspace\\.leon\\knowledge.',
      { kind: 'plugin', plugin: 'history-fixture' },
    )])
    const injected = await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: 'D:\\SampleWorkspace\\.leon\\knowledge',
    })
    expect(injected.isError).toBe(true)
    expect(executions.get('knowledge_status')).toHaveLength(0)
  })

  it('allows only the exact directly named target when exact is enabled', async () => {
    const { ctx, agent, executions } = await harness([marker], [knowledgeRule])
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge for this request.',
    )])

    expect((await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: 'd:/SAMPLEWORKSPACE/.LEON/KNOWLEDGE/',
    })).isError).toBe(false)
    expect((await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: 'D:\\SampleWorkspace\\.leon\\knowledge\\wiki',
    })).isError).toBe(true)
    expect((await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: 'E:\\Other\\.leon\\knowledge',
    })).isError).toBe(true)
    expect(executions.get('knowledge_status')).toEqual([{
      knowledge_root: 'd:/SAMPLEWORKSPACE/.LEON/KNOWLEDGE/',
    }])
  })

  it('rejects duplicate and blank additional rules at plugin load', async () => {
    const duplicate = new Context()
    await duplicate.plugin(SystemPrompt)
    await duplicate.plugin(ToolRuntime)
    await expect(duplicate.plugin(ExplicitTargetPolicy, {
      markers: [marker],
      additionalToolRules: [{ name: 'glob', argument: 'other' }],
    })).rejects.toThrow('duplicate tool path rule for glob')

    const blank = new Context()
    await blank.plugin(SystemPrompt)
    await blank.plugin(ToolRuntime)
    await expect(blank.plugin(ExplicitTargetPolicy, {
      markers: [marker],
      additionalToolRules: [{ name: '  ', argument: 'path' }],
    })).rejects.toThrow('additional tool names and arguments must not be blank')
  })

  it('rejects duplicate and blank blocked tool names at plugin load', async () => {
    const duplicate = new Context()
    await duplicate.plugin(SystemPrompt)
    await duplicate.plugin(ToolRuntime)
    await expect(duplicate.plugin(ExplicitTargetPolicy, {
      markers: [marker],
      blockedToolsWhileLocked: ['glob', 'glob'],
    })).rejects.toThrow('duplicate blocked tool name glob')

    const blank = new Context()
    await blank.plugin(SystemPrompt)
    await blank.plugin(ToolRuntime)
    await expect(blank.plugin(ExplicitTargetPolicy, {
      markers: [marker],
      blockedToolsWhileLocked: ['  '],
    })).rejects.toThrow('blocked tool names must not be blank')
  })
})

describe('required locked tool recovery', () => {
  const knowledgeRules = [
    {
      name: 'knowledge_status',
      argument: 'knowledge_root',
      requireLock: true,
      exact: true,
    },
    {
      name: 'knowledge_search',
      argument: 'knowledge_root',
      requireLock: true,
      exact: true,
    },
  ] satisfies ExplicitTargetPolicy.AdditionalToolRule[]

  it('steers one bounded correction before required tools run', async () => {
    const { ctx, agent, executions, steers } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status', 'knowledge_search'],
      1,
    )
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and verify it with the dedicated tools.',
    )])

    await turnStopping(ctx, agent)
    await expect(turnStopping(ctx, agent)).rejects.toThrow('REQUIRED_TOOLS_MISSING')

    expect(steers).toHaveLength(1)
    expect(steers[0]?.source).toMatchObject({
      kind: 'plugin',
      plugin: 'explicit-target-policy',
      form: 'notice',
      summary: 'required tools: continue protected turn',
    })
    const recoveryBlock = steers[0]?.content[0]
    expect(recoveryBlock).toMatchObject({
      type: 'text',
    })
    expect(recoveryBlock?.type === 'text' ? recoveryBlock.text : '').toContain(
      '`knowledge_status` e `knowledge_search`',
    )
    expect(executions.get('knowledge_status')).toHaveLength(0)
    expect(executions.get('knowledge_search')).toHaveLength(0)
  })

  it('does not steer again after knowledge status and search both succeed', async () => {
    const { ctx, agent, executions, steers } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status', 'knowledge_search'],
      2,
    )
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and verify it with the dedicated tools.',
    )])
    await turnStopping(ctx, agent)
    expect(steers).toHaveLength(1)

    await preStep(ctx, agent, [steers[0]!], 1, 2)
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 2 })
    const target = 'D:\\SampleWorkspace\\.leon\\knowledge'
    expect((await execute(
      ctx, agent, 'knowledge_status', { knowledge_root: target }, { turn: 1, step: 2 },
    )).isError).toBe(false)
    expect((await execute(
      ctx, agent, 'knowledge_search', { knowledge_root: target }, { turn: 1, step: 2 },
    )).isError).toBe(false)
    await turnStopping(ctx, agent)

    expect(steers).toHaveLength(1)
    expect(executions.get('knowledge_status')).toEqual([{ knowledge_root: target }])
    expect(executions.get('knowledge_search')).toEqual([{ knowledge_root: target }])
  })

  it('does not credit a root call that lacks a durable model tool/call in this turn', async () => {
    const { ctx, agent } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status'],
      0,
    )
    const target = 'D:\\SampleWorkspace\\.leon\\knowledge'
    await preStep(ctx, agent, [message(`Use ${target} for this request.`)])

    expect((await execute(ctx, agent, 'knowledge_status', {
      knowledge_root: target,
    })).isError).toBe(false)
    await expect(turnStopping(ctx, agent)).rejects.toThrow('REQUIRED_TOOLS_MISSING')
  })

  it('credits only the immutable final success published by tools/result', async () => {
    const { ctx, agent } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status'],
      0,
    )
    const target = 'D:\\SampleWorkspace\\.leon\\knowledge'
    await preStep(ctx, agent, [message(`Use ${target} for this request.`)])
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    ctx.on('tools/post-execute', async () => ({
      kind: 'block' as const,
      feedback: [{ type: 'text' as const, text: 'final policy rejected the result' }],
    }))

    const result = await execute(
      ctx, agent, 'knowledge_status', { knowledge_root: target }, { turn: 1, step: 1 },
    )
    expect(result.isError).toBe(true)
    await expect(turnStopping(ctx, agent)).rejects.toThrow('REQUIRED_TOOLS_MISSING')
  })

  it('requires every configured tool on every directly authorized target', async () => {
    const { ctx, agent } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status', 'knowledge_search'],
      0,
    )
    const first = 'D:\\A\\.leon\\knowledge'
    const second = 'E:\\B\\.leon\\knowledge'
    await preStep(ctx, agent, [message(`Compare ${first} with ${second}.`)])
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })

    for (const name of ['knowledge_status', 'knowledge_search']) {
      expect((await execute(
        ctx, agent, name, { knowledge_root: first }, { turn: 1, step: 1 },
      )).isError).toBe(false)
    }
    await expect(turnStopping(ctx, agent)).rejects.toThrow('knowledge_status@e:/b/.leon/knowledge')

    for (const name of ['knowledge_status', 'knowledge_search']) {
      expect((await execute(
        ctx, agent, name, { knowledge_root: second }, { turn: 1, step: 1 },
      )).isError).toBe(false)
    }
    await expect(turnStopping(ctx, agent)).resolves.toBeUndefined()
  })

  it('reconstructs target, successful tools, and recovery budget after remount', async () => {
    const config = {
      markers: [marker],
      additionalToolRules: knowledgeRules,
      requiredToolsWhileLocked: ['knowledge_status', 'knowledge_search'],
      maxRequiredToolRecoveries: 1,
    } satisfies ExplicitTargetPolicy.Config
    const { ctx, agent, steers, disposePolicy } = await harness(
      config.markers,
      config.additionalToolRules,
      [],
      config.requiredToolsWhileLocked,
      config.maxRequiredToolRecoveries,
    )
    const target = 'D:\\SampleWorkspace\\.leon\\knowledge'
    const direct = message(`Use ${target} for this request.`)
    agent.session.append('turn/start', { turn: 1 })
    await preStep(ctx, agent, [direct])
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', direct, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    await turnStopping(ctx, agent)
    expect(steers).toHaveLength(1)

    agent.session.append('step/start', { turn: 1, step: 2 })
    agent.session.append('user/message', steers[0]!, { surfaceOp: 'append' })
    for (const toolName of config.requiredToolsWhileLocked) {
      expect((await execute(
        ctx, agent, toolName, { knowledge_root: target }, { turn: 1, step: 2 },
      )).isError).toBe(false)
    }
    agent.session.append('step/end', { turn: 1, step: 2 })

    await disposePolicy()
    await ctx.plugin(ExplicitTargetPolicy, config)
    await preStep(ctx, agent, [steers[0]!], 1, 3)

    await expect(turnStopping(ctx, agent)).resolves.toBeUndefined()
    expect(steers).toHaveLength(1)
  })

  it('does not steer required-tool recovery without a direct-human lock', async () => {
    const { ctx, agent, steers } = await harness(
      [marker],
      knowledgeRules,
      [],
      ['knowledge_status', 'knowledge_search'],
      3,
    )
    await preStep(ctx, agent, [message('Inspect the current workspace without selecting an external target.')])

    await turnStopping(ctx, agent)

    expect(steers).toEqual([])
  })

  it('rejects duplicate and blank required tool names at plugin load', async () => {
    await expect(loadPolicy({
      markers: [marker],
      requiredToolsWhileLocked: ['knowledge_status', 'knowledge_status'],
    })).rejects.toThrow('duplicate required tool name knowledge_status')

    await expect(loadPolicy({
      markers: [marker],
      requiredToolsWhileLocked: ['  '],
    })).rejects.toThrow('required tool names must not be blank')
  })

  it('rejects a required tool that is also blocked', async () => {
    await expect(loadPolicy({
      markers: [marker],
      blockedToolsWhileLocked: ['knowledge_status'],
      requiredToolsWhileLocked: ['knowledge_status'],
    })).rejects.toThrow('required tool knowledge_status cannot also be blocked')
  })

  it('rejects a required tool without a target path rule', async () => {
    await expect(loadPolicy({
      markers: [marker],
      requiredToolsWhileLocked: ['untracked'],
    })).rejects.toThrow('required tool untracked must have a path rule')
  })

  it('uses zero recoveries when the optional limit is omitted', async () => {
    await expect(loadPolicy({ markers: [marker] })).resolves.toBeUndefined()
  })

  it.each([-1, 4, 1.5])('rejects invalid required-tool recovery limit %s', async (limit) => {
    await expect(loadPolicy({
      markers: [marker],
      maxRequiredToolRecoveries: limit,
    })).rejects.toThrow('maxRequiredToolRecoveries')
  })
})

describe('turn and lifecycle behavior', () => {
  it('retains a lock across plugin-only steps in one turn and clears it for a new human turn without a target', async () => {
    const { ctx, agent } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )], 1, 1)
    await preStep(ctx, agent, [message(
      'Time context', { kind: 'plugin', plugin: 'time-context' },
    )], 1, 2)
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(true)

    await preStep(ctx, agent, [message('Start another unrelated task.')], 2, 1)
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)
  })

  it('uses the messages accepted by downstream pre-step policy and ignores rejected proposals', async () => {
    const { ctx, agent } = await harness()
    const proposed = message('Use D:\\Rejected\\.leon\\knowledge.')
    expect(await preStep(ctx, agent, [proposed], 1, 1, { kind: 'reject' })).toEqual({ kind: 'reject' })
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)

    const accepted = message('Use E:\\Accepted\\.leon\\knowledge.')
    await preStep(ctx, agent, [proposed], 2, 1, { kind: 'enter', messages: [accepted] })
    expect((await execute(ctx, agent, 'glob', {
      path: 'E:\\Accepted\\.leon\\knowledge',
    })).isError).toBe(false)
  })

  it('removes both listener and guard when the plugin fiber is disposed', async () => {
    const { ctx, agent, disposePolicy } = await harness()
    await preStep(ctx, agent, [message(
      'Use D:\\SampleWorkspace\\.leon\\knowledge and do not change the target.',
    )])
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(true)

    await disposePolicy()
    expect((await execute(ctx, agent, 'glob', { path: '.' })).isError).toBe(false)
  })

  it('fails loudly for an empty or blank marker list', async () => {
    const empty = new Context()
    expect(() => { ExplicitTargetPolicy.apply(empty, { markers: [] }) }).toThrow(
      'explicit-target-policy: `markers` must not be empty',
    )

    const blank = new Context()
    await blank.plugin(SystemPrompt)
    await blank.plugin(ToolRuntime)
    await expect(blank.plugin(ExplicitTargetPolicy, { markers: ['  '] })).rejects.toThrow(
      'explicit-target-policy: every marker must contain non-whitespace text',
    )
  })
})

describe('real load path', () => {
  it('has no default export and preserves plugin metadata through loader unwrapping', () => {
    expect('default' in ExplicitTargetPolicy).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ExplicitTargetPolicy) as Record<string, unknown>
    expect(unwrapped).toBe(ExplicitTargetPolicy)
    expect(unwrapped.name).toBe('explicit-target-policy')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
