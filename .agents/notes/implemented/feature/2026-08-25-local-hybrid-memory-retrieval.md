# Agent Note: Optional local hybrid memory retrieval

Status: implemented

English | [中文](2026-08-25-local-hybrid-memory-retrieval.zh.md)

## Problem

The deterministic lexical provider preserved workspace isolation and worked without another model, but it could not reliably recall the same fact when the query used different vocabulary. Making a remote embedding service mandatory would weaken Leon's local-first boundary, and storing vectors durably before a migration design would add unnecessary recovery risk.

## Decision

- Extend the existing provider with an optional hybrid layer instead of adding a second durable provider or changing the memory schema.
- Use `nomic-embed-text:latest` through Ollama's `/api/embed` endpoint. Follow the model contract by prefixing queries with `search_query:` and documents with `search_document:`.
- Accept only unauthenticated HTTP origins on `127.0.0.1` or `::1`. Filter the workspace and bound the candidate set before sending any candidate text to Ollama.
- Keep lexical retrieval active on every request. Merge semantic and lexical scores, require a minimum score for semantic-only results, and return lexical results on timeout, transport, HTTP, validation, or response-size failure.
- Keep document vectors in a bounded in-process LRU cache keyed by memory id and revision. Invalidate after correction or forgetting and rebuild lazily after restart.
- Emit a content-free `memory/semantic-search` event with counts, duration, selected model, mode, and a sanitized failure code.
- Ship `semanticSearch.enabled: false`. The provider never downloads a model automatically.

The implementation follows the official [Nomic Embed model contract](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) and [Ollama embedding API](https://docs.ollama.com/api/embed).

## Verification

Tests prove same-meaning recall with different terms, mandatory workspace filtering before embedding, revision invalidation, bounded LRU behavior, deterministic lexical fallback, cancellation propagation, response bounds, strict loopback configuration, and sanitized telemetry. A real Cordis Loader composition boots the optional feature and retrieves a paraphrase. The two provider test files pass 56 cases with 100% statement, branch, function, and line coverage; all seven memory suites pass 96 cases. The repository-wide `check:all` run passed all 48 gates with none failed or skipped in 741.95 seconds.

On the Leon development machine, a real eight-input batch at 256 dimensions took about 7.7 seconds after a cold model load and 68.5–107.4 ms across four immediately warmed runs. This measurement justifies keeping the feature opt-in until LEON-EVAL-PTBR measures recall gains on representative Portuguese tasks.

## Alternatives considered

**Remote embedding API.** Rejected for the initial implementation because memory text would cross the local boundary and add credential, cost, and availability dependencies.

**Persistent vector database.** Deferred because the bounded candidate set does not yet justify migration, backup, recovery, and index-rebuild complexity.

**Semantic-only retrieval.** Rejected because it would turn an optional local model into a single point of failure and reduce deterministic exact recall.

**Automatic model download.** Rejected because installation mutates the machine, consumes storage and bandwidth, and must remain an explicit operator action.

## Consequences

Leon can now recover same-meaning project memories independently of the conversational model, so Qwen, Ornith, Gemini, or OpenAI can be changed without discarding the durable knowledge seam. The feature remains local, reversible, and isolated by workspace. Cold-start latency and linear candidate reranking remain real costs; enabling it in the product requires a successful LEON-EVAL-PTBR gate rather than an architectural assumption.
