/**
 * Web egress approval. Every call to a listed web tool becomes an `ask`
 * pre-execute decision, so the registry routes it through the approval service
 * before the tool body runs and nothing leaves the machine without a one-shot
 * grant. The prompt carries the complete arguments: the user must see the exact
 * queries or URL, including parameters that might hold private data.
 *
 * Without an approval service, without an agent, or under the `never` approval
 * policy the registry's own `ask` resolution denies the call, so the guard
 * fails closed.
 *
 * @module @deepseek-ai/dsh-web-egress-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-egress-approval'

/** The tool registry whose `tools/pre-execute` waterfall this guard joins. */
export const inject = ['tools']

/** Configuration for the web egress approval guard. */
export interface Config {
  /** Tool names whose every call needs a one-shot approval before it runs. */
  tools: string[]
  /** Upper bound on the serialized arguments shown in the prompt; longer arguments are truncated with a marker. */
  maxArgumentChars: number
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  tools: z.array(z.string().min(1)).default(['web_search', 'web_fetch']),
  maxArgumentChars: z.natural().min(256).default(8192),
})

/** Localized explanations, keyed by the tool kind the prompt is about. */
const EXPLANATIONS = {
  search: {
    en: 'Allow sending the queries below to the search provider? Check them for private data. The approval covers this call only.',
    zh: '是否允许把下列查询发送给搜索服务？请检查其中是否含有私人数据。本次批准只对这一次调用有效。',
    'pt-BR': 'Autorizar o envio das consultas abaixo ao provedor de pesquisa? Confira se contêm dados privados. A autorização vale somente para esta chamada.',
  },
  fetch: {
    en: 'Allow sending the URL below to the web access provider and the destination site? Check the full address, including parameters that may hold private data. The approval covers this call only.',
    zh: '是否允许把下列 URL 发送给网页访问服务和目标网站？请检查完整地址，包括可能含有私人数据的参数。本次批准只对这一次调用有效。',
    'pt-BR': 'Autorizar o envio da URL abaixo ao provedor de acesso web e ao site de destino? Confira o endereço completo, inclusive parâmetros que possam conter dados privados. A autorização vale somente para esta chamada.',
  },
  other: {
    en: 'Allow this web call to send the arguments below outside this machine? The approval covers this call only.',
    zh: '是否允许这次网页调用把下列参数发送到本机之外？本次批准只对这一次调用有效。',
    'pt-BR': 'Autorizar esta chamada web a enviar os argumentos abaixo para fora desta máquina? A autorização vale somente para esta chamada.',
  },
} as const

/**
 * Serialize the call arguments for the prompt, bounded by the configured size.
 * @param exec - the pending call.
 * @param limit - maximum characters before truncation.
 * @returns the pretty-printed arguments.
 */
function renderArguments(exec: Pick<ToolExecution, 'arguments'>, limit: number): string {
  const text = JSON.stringify(exec.arguments, null, 2) ?? 'null'
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (truncated, ${text.length - limit} more characters)`
}

/**
 * Build the `ask` decision for one web call.
 * @param exec - the pending call's tool name and arguments.
 * @param config - the guard configuration.
 * @returns an ask whose reason and localized display reasons carry the full arguments.
 */
export function egressAsk(exec: Pick<ToolExecution, 'name' | 'arguments'>, config: Config): Extract<PreToolDecision, { kind: 'ask' }> {
  const kind = exec.name === 'web_search' ? 'search' : exec.name === 'web_fetch' ? 'fetch' : 'other'
  const args = renderArguments(exec, config.maxArgumentChars)
  const explanation = EXPLANATIONS[kind]
  return {
    kind: 'ask',
    reason: `${explanation.en}\n\n${args}`,
    displayReason: {
      en: `${explanation.en}\n\n${args}`,
      zh: `${explanation.zh}\n\n${args}`,
      'pt-BR': `${explanation['pt-BR']}\n\n${args}`,
    },
  }
}

/**
 * Register the guard. It lets every later listener decide first and only turns
 * an `allow` into an `ask`: a denial, cancellation, or an ask from another
 * policy keeps its own meaning.
 */
export function apply(ctx: Context, config: Config): void {
  const tools = new Set(config.tools)
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const decision = await next()
    if (decision.kind !== 'allow' || !tools.has(exec.name)) return decision
    return egressAsk(exec, config)
  })
}
