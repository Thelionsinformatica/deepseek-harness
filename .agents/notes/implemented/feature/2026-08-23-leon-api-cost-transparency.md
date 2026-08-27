# Agent Note: Leon API cost transparency

Status: implemented

English | [中文](2026-08-23-leon-api-cost-transparency.zh.md)

## Problem

Leon Automatic can move work from the local Ollama route to an authorized Gemini route, while the existing token meter reports only token volume. A user could see which model ran but could not estimate the resulting API expense inside Leon. A single hard-coded total would also become misleading when a provider changes rates, the account uses a free or priority tier, or a newly selected model has no known price.

## Decision

The `sessionStats` projection accepts a deployment-owned exact provider/model price table and publishes `estimatedApiCostUsdNanos`, `pricedModelCalls`, and `unpricedModelCalls` beside its existing whole-log figures. Provider-reported disjoint input, output, cache-read, and cache-write usage is priced in integer billionths of one US dollar. A finalized message replaces an earlier stream sample for the same step, so ordinary usage delivery is not counted twice. An exact route absent from the table increments the unpriced counter instead of disappearing inside an apparently complete zero.

Pricing remains outside the pi-ai adapter and does not reverse the no-adapter-pricing decision in the [declared provider catalog](../architecture/2026-08-03-pi-ai-declared-provider-catalog.md). The adapter owns provider usage and actual model identity; the deployment owns prices because billing plan, currency, effective date, and chosen safety margin are installation policy. A configured local Ollama route uses explicit zero prices, which lets the UI distinguish “priced at zero” from “unknown price.”

The conversation statistics strip shows the current session estimate and any unpriced-call warning. The Leon Work dashboard sums the projection across every stored session, including archived and subagent sessions whose calls still incurred cost, and labels the result as accumulated API usage. The shipped Web table uses Google's paid Standard token rates available on 2026-08-23, including the introductory Gemini 3.6 and 3.7 Flash rates effective through 2026-12-31. It is an editable estimate, not a provider invoice. Search or Maps grounding queries, cache storage time, media duration charges, tax, credits, free-tier allowances, non-Standard multipliers, and failed calls without reported usage stay outside the token estimate.

## Alternatives considered

**Hard-code prices in the provider adapter.** Rejected because the same model can have free, Standard, Batch, Flex, Priority, or negotiated pricing, and changing commercial policy should not require changing request translation.

**Derive cost in the browser from the aggregate token meter.** Rejected because aggregate buckets no longer identify which exact model produced each call, especially after automatic routing or failover, and browser paging must not change accounting.

**Rely exclusively on the provider billing console.** Rejected because the console remains the invoice authority but does not give Leon an immediate per-session estimate or expose that a selected route lacks configured pricing.

## Testing

Projection tests pin exact token math, zero-cost local calls, stream-to-final replacement, unknown-route accounting, and duplicate-price rejection. Conversation tests pin small-value formatting, session estimates, local zero, and unpriced warnings. Dashboard tests pin accumulated projection totals, the empty state, and the warning state. Loader/type checks validate the configuration boundary and cross-package projection shape.

## Consequences

Leon now gives the user an immediate, durable indication of API spend while keeping unknown portions visible. The value can differ from the eventual invoice and must be updated when rates or plans change. A future operation ledger is still required before Leon can estimate non-token features such as grounded search queries or recurring cache storage.
