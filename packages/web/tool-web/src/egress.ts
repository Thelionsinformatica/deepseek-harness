/** One-shot outbound consent enforced inside each native web tool's executor. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { WebError } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-web-access'

/**
 * Require a fresh audited grant before contacting the web service. The prompt
 * includes complete arguments because some answerers only display shell commands
 * from a paired call; a web approval must remain inspectable on those clients.
 * @param ctx - context resolving the optional approval service.
 * @param exec - immutable call identity, owning agent, and cancellation signal.
 * @param policy - deployment choice; `allow` adds no web-specific approval.
 * @throws when cancelled, no approval route exists, or the decision is not a grant.
 */
export async function authorizeWebEgress(
  ctx: Context,
  exec: ToolRunContext,
  policy: 'ask' | 'allow',
): Promise<void> {
  exec.signal.throwIfAborted()
  // A session event is the only broad grant: it is explicit, auditable, and
  // can be revoked immediately. It is intentionally scoped to these native
  // web executors — it does not change shell, browser, credentials, or any
  // other outbound capability.
  if (policy === 'allow' || (exec.agent !== undefined && ctx.get('webAccess')?.isEnabled(exec.agent.session))) return
  const approval = ctx.get('approval')
  if (approval === undefined || exec.agent === undefined) {
    throw new WebError('Saída web bloqueada: não há canal de aprovação associado a esta chamada.', 'WEB_APPROVAL_REQUIRED')
  }
  const explanation = exec.name === 'web_search'
    ? 'Autorizar o envio das consultas abaixo ao provedor de pesquisa? Confira se contêm dados privados. A autorização vale somente para esta chamada.'
    : 'Autorizar o envio da URL abaixo ao provedor de acesso web e ao site de destino? Confira o endereço completo, inclusive parâmetros que possam conter dados privados. A autorização vale somente para esta chamada.'
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason: `${explanation}\n\n${JSON.stringify(exec.arguments, null, 2)}`,
    signal: exec.signal,
  })
  exec.signal.throwIfAborted()
  if (outcome !== 'allowed-once') {
    throw new WebError(`Saída web bloqueada: aprovação não concedida (${outcome}). Não tente enviar os mesmos dados por outra ferramenta.`, 'WEB_APPROVAL_DENIED')
  }
}
