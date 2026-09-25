/** Refuse assembled requests whose estimated input and output reserve exceed model capacity. */
import type { Context } from '@deepseek-ai/cordis'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { estimateHeader, estimateMessage } from '@deepseek-ai/dsh-token-meter'

/**
 * Check the effective stream request after queued instructions and routing have been assembled.
 * Known overflows use the ordinary terminal failure protocol, enabling bounded recovery.
 * Unknown capacity remains the adapter's responsibility; character estimates are not tokenization.
 * @param ctx - compaction plugin scope owning the final-dispatch admission listener.
 */
export function installRequestAdmission(ctx: Context): void {
  ctx.on('llm/admission', (options, model) => {
    if (model.context !== undefined) {
      const inputTokens = estimateHeader({
        config: options,
        ...options.system === undefined ? {} : { system: options.system },
        ...options.tools === undefined ? {} : { tools: options.tools },
      }) + options.messages.reduce((total, message) => total + estimateMessage(message), 0)
      const outputTokens = options.maxTokens ?? 0
      if (inputTokens + outputTokens > model.context.contextWindow) {
        return {
          code: CONTEXT_WINDOW_EXCEEDED_CODE,
          message: `Request refused before inference: estimated input (${inputTokens} tokens) `
            + `plus output reserve (${outputTokens} tokens) exceeds the context capacity `
            + `(${model.context.contextWindow} tokens) for ${options.provider}/${options.model}. `
            + 'Reduce the request context; history and required instructions are preserved.',
        }
      }
    }
  })
}
