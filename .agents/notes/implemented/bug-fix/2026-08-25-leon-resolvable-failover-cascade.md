# Agent Note: Leon resolvable failover cascade

Status: implemented

English | [中文](2026-08-25-leon-resolvable-failover-cascade.zh.md)

## Problem

Leon Automatic could replace a failed provider only with the first configured candidate. If that intermediate candidate could not resolve because its adapter or model was unavailable, recovery returned to the failed provider's ordinary retry policy. The shipped local and loopback routes omitted an explicit policy, so this path could repeat the already failed request five times and never reach a later configured fallback.

## Decision

The API proxy now resolves failover candidates as a bounded provider cascade. When an intermediate candidate cannot resolve, its provider becomes the failed edge for the next configured selection. A visited-provider set rejects cycles, and a 16-hop ceiling protects the recovery waterfall from a malformed policy that manufactures an unbounded chain. Only the final resolvable replacement is persisted as `llm/failover`; no request is dispatched to skipped candidates.

The shipped Ollama and OmniRoute profiles each declare a normal retry policy with `maxRetries: 1`. Automatic mode still attempts cross-provider replacement before that policy. The single retry is a final bounded recovery for manual selection or for deployments where no configured replacement resolves. Settings-managed Gemini configuration and credentials remain unchanged.

## Alternatives considered

**Delegate immediately when the first candidate cannot resolve.** Rejected because an optional intermediate adapter must not prevent a later configured direct provider from assuming the request.

**Probe every provider before admitting each prompt.** Rejected because a catalog or health probe does not prove request execution, adds latency to healthy paths, and duplicates the authoritative model-request failure boundary.

**Retry the original provider five times after cascade exhaustion.** Rejected because repeated connection failures hide a configuration problem and make the interface look stalled. One bounded retry retains tolerance for a short transient without restoring the long wait.

## Testing

Host integration tests prove that an unavailable intermediate adapter is skipped, the next valid route receives the same request, only the successful replacement is logged, provider cycles delegate once without hanging, cancellation stops the cascade without delegating more work, manual selection never crosses providers, and ordinary retry remains bypassed for a valid automatic replacement. Base and Web composition tests pin the one-retry local policies and the deployed fallback chain.

## Consequences

Leon Automatic can continue past an unavailable OmniRoute or direct provider adapter instead of becoming trapped behind it. The user still sees one durable route-change notice naming the route that actually assumed the request. If every configured replacement is unavailable, the original local or loopback route receives at most one eligible retry before the turn fails clearly. Cloud use remains limited to the deployment's explicit failover edges.
