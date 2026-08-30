# Agent Note: Leon narrows automatic routing after autonomy evidence

Status: implemented

English | [中文](2026-08-28-leon-automatic-routing-safety-hold.zh.md)

## Problem

Leon Automatic promoted complex and goal-driven work from Qwen to Ornith before either route had completed the long autonomous acceptance. The first LEON-ACC-008 run showed that Qwen produced an oracle-passing implementation but violated the task protocol and budgets, while Ornith exhausted the recovery wall-clock budget without repairing the injected regression. A model catalog entry or a successful short response therefore did not justify automatic specialist promotion.

The Ollama failover edge also treated `UNKNOWN_MODEL` and `NO_ADAPTER` like service outages. Those codes identify a deployment configuration error; sending the same request to an external provider would conceal that error and cross the local-to-external residency boundary for the wrong reason.

## Decision

Leon Automatic uses `ollama/qwen3.5:9b` for fast, main, expert, and automatic goal-round tiers. The classifier still raises reasoning effort from off to medium or high, so the UI preserves visible tier and effort behavior without selecting an unqualified specialist. Ornith remains in the Ollama catalog for explicit manual selection and is absent from the automatic preflight candidate list.

The manual catalog also exposes `ollama/qwen3.8-distill:9b-q8` with a 16,384-token context window beside the existing Heretic route. Both Qwen 3.8 entries and Ornith stay outside automatic and shadow routing until a later policy change is supported by long-autonomy evidence.

The Ollama-to-FreeLLMAPI edge accepts only `TRANSPORT`, `TIMEOUT`, and `SERVER`. `UNKNOWN_MODEL` and `NO_ADAPTER` stop on the local route and expose the configuration error. Later FreeLLMAPI-to-Gemini and Gemini-to-OpenAI edges retain their provider-specific eligibility.

The shadow policy revision is `leon-shadow-v2`. Qwen is its sole local candidate and carries the deployed expert-quality tier because it is the active high-effort route; external candidates remain fallback-only. The read-only doctor requires only `qwen3.5:9b` for automatic-route readiness, while manual model presence is informational.

## Verification

The recorded LEON-ACC-008 artifact is failed and preserves both local model digests, local-only request evidence, the passing implementation oracle, the failed post-injection recovery oracle, protocol violations, and budget failures. Focused bundle and routing tests pin one automatic model across all prompt tiers, the absence of Ornith from the shadow catalog, the two configuration errors that fail closed, the manual Qwen 3.8 catalog entry and zero local cost, and the doctor requirement for Qwen alone.

## Alternatives considered

**Keep Ornith automatic because short prompts completed.** Rejected because short completion does not prove autonomous diagnosis, constrained tool use, recovery, or evidence-backed completion.

**Remove Ornith and the Qwen 3.8 routes from the catalog.** Rejected because manual selection is an explicit user decision and remains useful for controlled evaluation; the evidence only disqualifies automatic promotion.

**Fail over every Ollama error to preserve availability.** Rejected because availability cannot justify hiding an invalid model or missing adapter by transmitting local context externally.

## Consequences

Automatic sessions use one known local model at varying effort until another candidate passes the required long-autonomy evidence. This reduces automatic model diversity and does not claim that Qwen itself has passed LEON-ACC-008; it removes the observed Ornith promotion failure while keeping a deterministic route for further work. Configuration defects remain visible and local. Manual specialists retain no automatic health guarantee and must be selected deliberately.
