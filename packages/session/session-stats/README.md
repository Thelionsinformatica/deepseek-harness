# @deepseek-ai/dsh-session-stats

English | [中文](README.zh.md)

Function plugin registering the `sessionStats` projection unit: whole-log conversation figures — turn/step counts, the LLM, tool, first-token, and decode wall times, and an optional configured API cost estimate — folded from step boundaries, stream chunks, tool pairs, and assembled assistant messages, and served through the session-projection seam (registry snapshot, change feed, and every projection carrier: history tail page, `session/projection` push frames, session list rows). Clients render full-session figures that paging and compaction cannot change; the reference consumers are the web chat stats strip and Leon Work dashboard.

## Fold semantics

- `steps` counts `step/end` events. The agent loop appends exactly one per entered step, in a `finally`, so completed, failed, cancelled, and max-tokens steps all count. Counting assembled assistant messages instead would overcount max-tokens usage-host messages (empty content, excluded from the surface) and undercount cancelled steps (aborted before the message assembles).
- `turns` counts distinct turns carrying at least one closed step; rejected or empty turns (closed with no step) are uncounted. Turn numbers are host-assigned and monotonic per session, so the fold keeps only the last counted turn.
- `llmMs` sums `step/start` → `assistant/message` per step that assembled a message (retry waits inside the step are model time, as in the window fold).
- `ttftMs`/`ttftSteps` sum and count `step/start` → first non-empty delta chunk; the first attempt's boundary survives an in-step `llm/retry` (window `resetForRetry` parity).
- `decodeMs`/`decodeTokens` sum first token → assembled message and the provider-reported output tokens, only over steps carrying both.
- `toolMs` sums `tool/call` → `tool/result` pairs matched by callId; unresolved calls are dropped at `turn/end` (results land within their turn).
- `estimatedApiCostUsdNanos` stores integer billionths of one US dollar. An exact `providerCostUsdNanos` reported by a provider or gateway wins; otherwise usage is priced through the configured provider/model table. A stream usage sample is replaced by the finalized message sample for the same step, rather than counted twice. `pricedModelCalls` includes explicit zero charges and configured zero-cost local routes; `unpricedModelCalls` makes usage from unknown routes visible instead of silently presenting an incomplete estimate as complete.
- Every field is 0 until its first contributing event. A composed registry always serves the key, so clients read the value, never key presence.

## Composition

```yaml
- id: session-stats
  name: '@deepseek-ai/dsh-session-stats'
  config:
    prices:
      - provider: ollama
        model: qwen3.5:9b
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
      - provider: google
        model: gemini-3.6-flash
        inputUsdPerMillion: 0.75
        outputUsdPerMillion: 3.75
        cacheReadUsdPerMillion: 0.075
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

The deployment owns this table because provider prices, paid/free plans, currencies, effective dates, and model identifiers change independently of the package. Omitting `prices` disables table-based estimates, but exact provider-reported charges still fold when present. The shipped Leon Web composition uses an editable paid Standard price snapshot; the displayed total can mix exact gateway charges with token-price estimates and is not a provider invoice.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Steps count work attempted, not visible output** — a step that failed before producing any visible content still closed with `step/end` and counts; a step interrupted by a crash counts after the session reloads, when crash recovery appends its synthetic `step/end` (`interruptedTurnClosers` in dsh-session).
- **A cancelled step is counted but untimed** — no assistant message assembles, so its partial stream time enters no wall-time figure, matching the window fold's untimed interrupted node; a max-tokens usage-host message conversely contributes model time the surface does not show.
- **Counts are log-scoped, not surface-scoped** — steps whose messages were later compacted away stay counted; the figures describe the whole session, not the current model-visible surface.
- **Only durable usage charges are counted** — exact provider/gateway response charges can include what that response reports, while table-priced routes still estimate tokens only. Search/Maps grounding requests, cache storage time, media charged by duration, taxes, credits, free-tier allowances, Batch/Flex/Priority multipliers, and calls that fail without a usage report may remain outside this projection. The UI exposes unpriced model calls, but full invoice reconciliation still requires the provider billing console.
- **Pricing is a deployment snapshot** — the plugin does not fetch live prices or infer the account's billing tier. Operators must update the exact-route table when providers change rates or a different plan is selected.
- **Mounted only in the web-app bundle** — other assemblies serve no `sessionStats` key, and their consumers fall back to window-scoped counting (the web stats strip's fallback path).
