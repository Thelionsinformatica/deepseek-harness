/**
 * Provider-neutral model tier selection for Leon Web prompts.
 * The classifier is deliberately deterministic and network-free: it chooses
 * only between routes the deployment explicitly configured. Goal-round tiers
 * may opt into stronger routes without embedding credentials.
 */

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { PromptContentPart } from './api/sessions.ts'
import type { AdaptiveRoutingShadowConfig } from './adaptive-routing-shadow.ts'

/** One explicitly configured route used from a numbered goal round onward. */
export interface AdaptiveGoalRoundTier {
  /** First automatic goal round that may use this route. */
  fromRound: number
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Provider-owned reasoning effort. */
  reasoningEffort?: string
}

/** Explicit provider replacement used when an automatic route is unavailable. */
export interface AdaptiveFailoverConfig {
  /** Failed providers eligible for replacement. */
  fromProviders: string[]
  /** Registered replacement provider route. */
  provider: string
  /** Provider-owned replacement model id. */
  model: string
  /** Provider-owned reasoning effort for the replacement request. */
  reasoningEffort?: string
  /** Local execution or a route that may transmit request content externally. */
  residency?: 'local' | 'external'
  /** Provider-neutral failure codes that prove the active route is unavailable. */
  failureCodes: string[]
}

/** Prompt tiers plus optional provider-neutral goal-round escalation. */
export interface AdaptiveRoutingConfig {
  /** Provider route used when a tier does not name its own provider. */
  provider: string
  /** Registered provider route for short, self-contained requests. */
  fastProvider?: string
  /** Registered provider route for contextual or medium-complexity work. */
  mainProvider?: string
  /** Registered provider route for the most complex work. */
  expertProvider?: string
  /** Model used for short, self-contained requests. */
  fastModel: string
  /** Stronger local model used for contextual or medium-complexity work. */
  mainModel: string
  /** Optional specialist model reserved for the most complex work. */
  expertModel?: string
  /** Provider-owned reasoning effort used with the fast tier. */
  fastReasoningEffort?: string
  /** Provider-owned reasoning effort used with the main tier. */
  mainReasoningEffort?: string
  /** Stronger effort used for large, highly structured first requests. */
  expertReasoningEffort?: string
  /** Maximum normalized text length eligible for the fast tier. */
  simpleMaxCharacters?: number
  /** Minimum normalized text length promoted from main to expert effort. */
  expertMinCharacters?: number
  /** Ordered escalation policy; the highest eligible `fromRound` wins. */
  goalRoundTiers?: AdaptiveGoalRoundTier[]
  /** Ordered replacements for unavailable automatic routes. First eligible route wins. */
  failovers?: AdaptiveFailoverConfig[]
  /** Passive preflight that records recommendations without changing the active route. */
  shadow?: AdaptiveRoutingShadowConfig
}

/** Prompt facts available before the durable user message is admitted. */
export interface AdaptiveRoutingInput {
  content: readonly PromptContentPart[]
  /** Whether the session already contains a completed or open turn. */
  hasHistory: boolean
  /** Positive automatic goal round currently entering a model request. */
  goalRound?: number
}

/** Transparent result consumed by the Host admission boundary. */
export interface AdaptiveRoutingDecision {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  tier: 'fast' | 'main' | 'expert' | 'goal-round' | 'failover'
}

/** Failed request facts available before ordinary provider retry policy runs. */
export interface AdaptiveFailoverInput {
  provider: string
  failureCode: string
  hasImage?: boolean | undefined
}

const MAIN_MARKERS = [
  /```/u,
  /\b(?:analise|analisar|implemente|implementar|refatore|refatorar|corrija|corrigir)\b/iu,
  /\b(?:investigue|investigar|pesquise|pesquisar|compare|comparar|planeje|planejar|projeto)\b/iu,
  /\b(?:c[oó]digo|arquivo|documento|servidor|banco de dados|seguran[cç]a|deploy|debug|diagnos)\b/iu,
  /\b(?:design|build|implement|refactor|architecture|audit|research|investigate|compare|plan)\b/iu,
  /\b(?:testes?\s+(?:unit[aá]rios?|automatizados?|de integra[cç][aã]o)|unit tests?|integration tests?)\b/iu,
  /[{}<>]/u,
  /\b(?:function|class|interface|SELECT|INSERT|UPDATE|DELETE)\b/iu,
] as const
const EXPERT_MARKERS = [
  /\b(?:auditoria\s+completa|arquitetura\s+completa|toda\s+a\s+arquitetura|projeto\s+completo|an[aá]lise\s+profunda)\b/iu,
  /\b(?:complete\s+audit|full\s+architecture|complete\s+project|deep\s+analysis)\b/iu,
  /\b(?:seguran[cç]a|security)\b.*\b(?:arquitetura|architecture|deploy|produ[cç][aã]o|production)\b/iu,
] as const
const CONTINUATION_MARKERS = /^(?:continue|continuar|pode continuar|prossiga|siga|fa[cç]a isso|agora fa[cç]a|continue de onde|retome)\b/iu

/**
 * Choose the cheapest capable configured tier for one prompt.
 *
 * Multi-line work, code/technical markers, longer prompts and terse
 * continuation instructions in an established session use the main model.
 * Images, very large structured prompts and explicit high-complexity markers
 * use the optional expert model (or only raise main-model effort when no
 * separate expert model is configured).
 * A numbered goal round first consults the explicit escalation tiers. Every
 * selected route still passes through the Host's ordinary availability check.
 * Everything else within the configured bound uses the fast model.
 * @param config - Explicit prompt tiers and optional goal-round escalation.
 * @param input - Prompt content and existing-session context.
 * @returns the selected local route and its transparent tier label.
 */
export function chooseAdaptiveModel(
  config: AdaptiveRoutingConfig,
  input: AdaptiveRoutingInput,
): AdaptiveRoutingDecision {
  const goalRound = input.goalRound
  const goalTier = goalRound === undefined
    ? undefined
    : config.goalRoundTiers
      ?.filter(tier => tier.fromRound <= goalRound)
      .toSorted((left, right) => right.fromRound - left.fromRound)[0]
  if (goalTier !== undefined) {
    return {
      provider: goalTier.provider,
      model: goalTier.model,
      ...goalTier.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(goalTier.reasoningEffort) },
      tier: 'goal-round',
    }
  }
  const text = input.content
    .filter((part): part is Extract<PromptContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
    .trim()
  const max = config.simpleMaxCharacters ?? 280
  const expertMin = config.expertMinCharacters ?? 800
  const hasImage = input.content.some(part => part.type === 'image')
  const lineCount = text.split(/\r?\n/u).length
  const contextualContinuation = input.hasHistory && CONTINUATION_MARKERS.test(text)
  const explicitExpert = EXPERT_MARKERS.some(marker => marker.test(text))
  const complex = hasImage
    || text.length > max
    || lineCount > 4
    || MAIN_MARKERS.some(marker => marker.test(text))
    || explicitExpert
    || contextualContinuation
  const expertEnabled = config.expertModel !== undefined || config.expertReasoningEffort !== undefined
  const expert = complex && expertEnabled
    && (hasImage
      || text.length >= expertMin
      || lineCount > 12
      || explicitExpert)
  const reasoningEffort = expert
    ? config.expertReasoningEffort
    : complex ? config.mainReasoningEffort : config.fastReasoningEffort
  return {
    provider: expert && config.expertModel !== undefined
      ? config.expertProvider ?? config.provider
      : complex
        ? config.mainProvider ?? config.provider
        : config.fastProvider ?? config.provider,
    model: expert && config.expertModel !== undefined
      ? config.expertModel
      : complex ? config.mainModel : config.fastModel,
    ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
    tier: expert ? 'expert' : complex ? 'main' : 'fast',
  }
}

/**
 * Choose an explicitly configured replacement for an unavailable automatic route.
 * @param config - Automatic routing configuration with ordered replacement routes.
 * @param input - Failed provider and normalized provider-neutral failure code.
 * @returns the replacement route, or `undefined` when failover is not configured or eligible.
 */
export function chooseAdaptiveFailover(
  config: AdaptiveRoutingConfig,
  input: AdaptiveFailoverInput,
): AdaptiveRoutingDecision | undefined {
  const failover = config.failovers?.find(candidate =>
    candidate.fromProviders.includes(input.provider)
    && candidate.failureCodes.includes(input.failureCode)
    && candidate.provider !== input.provider
    && !(input.hasImage === true && candidate.residency === 'external'),
  )
  if (failover === undefined) return undefined
  return {
    provider: failover.provider,
    model: failover.model,
    ...failover.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(failover.reasoningEffort) },
    tier: 'failover',
  }
}
