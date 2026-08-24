# Agent Note: Leon evaluates model routes in shadow mode before enforcement

Status: implemented

English | [中文](2026-08-24-leon-shadow-routing-preflight.zh.md)

## Problem

Leon Automatic selected a local tier from prompt length and markers, then relied on provider failure to enter OmniRoute, Gemini, or OpenAI. A real long-running test showed the weakness of that order: the local model spent more than a minute, reached an output ceiling, remained selected for the continuation, and only then failed with `CONTEXT_WINDOW_EXCEEDED`. The system had no durable evidence showing whether a capability-aware decision made before dispatch would have chosen differently.

Immediate automatic enforcement would replace one unmeasured heuristic with another. The replacement policy also needed to distinguish request capacity from provider health, respect local-first privacy, estimate external cost only when pricing is known, and avoid storing the content it evaluates.

## Decision

The Web deployment keeps its current adaptive selection and failover behavior while `adaptiveRouting.shadow` installs a passive preflight at the final `llm/stream` boundary. That boundary exposes the exact frozen request assembled by the agent loop and still precedes adapter consumption. The observer calls the downstream stream unchanged, resolves candidate capabilities asynchronously, and appends one `llm/routing-shadow` event with the route it observed and the route it would recommend.

Candidate identity, residency, relative quality, deployment priority, cold-start TTFT baseline, and optional prices are explicit deployment policy. Context window, output allowance, and input modalities come from the registered adapter's exact-model metadata. Current request pressure comes from `ctx.tokenMeter` when mounted; a conservative structural estimate is used only in compositions without that service. The decision reserves output and tool-loop growth before comparing projected pressure to each context window.

External routing policy is explicit. The shipped Leon configuration uses `fallback-only`: a capable local route suppresses external recommendations, but external candidates may be recommended when all local candidates fail capacity, modality, health, recent same-session capacity, or minimum-quality checks. Route priority preserves the intended order without embedding Leon model names in the policy implementation.

## Audit and privacy contract

The durable event carries a schema version, policy version, random request correlation id, Turn and Step, observed route, structural counts, token estimates and reserves, candidate capability summaries, ordered rejection reason codes, projected configured cost when price metadata is complete, recommendation, and a `wouldChange` flag. It never carries prompt text, system text, tool schemas, messages, credentials, provider errors, or hashes of that content. Manual model sessions and auxiliary title or compaction requests are outside observation.

Shadow mode has no execution authority. It cannot alter provider, model, reasoning effort, retries, admission, or the returned stream. Capability resolution and event publication run out of band; an observation failure is warned and leaves the live request untouched.

## Health and capacity semantics

Provider health is process-local and route-specific. Successful terminal responses update an exponential moving TTFT baseline; each route has an explicit cold-start baseline until enough samples exist. Relative latency may mark a route degraded, while a circuit opens only after the configured number of consecutive provider failures. No universal fixed latency threshold opens a circuit.

`MAX_TOKENS`, `CONTEXT_WINDOW_EXCEEDED`, and `CONTEXT_LENGTH_EXCEEDED` are capacity outcomes, not provider-health failures. They are retained only for the same Session and route for a bounded cooldown, allowing the next related request to avoid repeating a known capacity mismatch without poisoning that model for unrelated Sessions.

## Alternatives considered

**Enable the new recommendation as the live router immediately.** Rejected because the policy has not yet accumulated disagreement, false-positive, latency, and cost evidence on Leon's real workload. Shadow mode creates that evidence without introducing a new failure path.

**Keep only the existing prompt marker classifier.** Rejected because it cannot see the complete system prompt, tool schemas, accumulated history, output reserve, exact registered context window, or a recent capacity outcome—the facts implicated by the observed failure.

**Treat context overflow as a provider outage and use the existing failover circuit.** Rejected because the provider may be healthy for smaller requests; a global route penalty would make one oversized Session increase cost and data egress for unrelated work.

**Log prompts or prompt hashes for later evaluation.** Rejected because raw content would violate the local-first boundary, and stable hashes can still expose equality and dictionary-attack information. Structural metadata is sufficient for this phase.

**Probe every candidate with a model call before selecting.** Rejected because probes add cost, latency, possible data transmission, and side-effect ambiguity. Exact registered capability metadata is the only candidate input in shadow mode.

## Verification

Unit tests pin local-first selection, projected context overflow before dispatch, same-session capacity handling without circuit poisoning, external deny behavior, price projection, duplicate-route refusal, and configuration defaults. An integration test sends an agent-loop-marked request through the real `llm/stream` waterfall, proves that the original route and terminal chunk are unchanged, waits for the durable shadow event, and verifies that the prompt text is absent. The generated persistence catalog includes `llm/routing-shadow`, and the Web bundle test pins the shipped route catalog and shadow policy.

## Consequences

Leon now produces measurable evidence for a better preflight while preserving the behavior the user is currently testing. Session exports can compare actual and recommended routes without exposing conversation content, and the recorded rejection codes distinguish unavailable, incapable, privacy-blocked, unhealthy, and recently capacity-limited candidates.

The recommendation is not yet displayed as a dedicated dashboard card and does not change the live model. A later enforcement decision requires evidence from real Sessions, explicit false-positive and cost thresholds, and a separately reviewed UI and control contract. Runtime health is intentionally process-local; durable cross-process health would require an independent telemetry retention policy rather than silently turning Session logs into a global circuit-breaker database.
