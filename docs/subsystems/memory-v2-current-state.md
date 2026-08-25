# Memory V2 plan — Current state (Leon baseline)

English | [中文](memory-v2-current-state.zh.md)

## 1) Current-state diagnosis

- Current branch: `leon/identity-pt-br` (`git branch --show-current`).
- Local application endpoint: `http://127.0.0.1:3080/`.
- The memory core is present and functional with a provider-neutral, workspace-scoped architecture:
  - `ctx.memory` service seam: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
  - Local provider: [`packages/memory/memory-local/src/index.ts`](../../packages/memory/memory-local/src/index.ts)
  - Tool and recall consumer: [`packages/memory/tool-memory/src/index.ts`](../../packages/memory/tool-memory/src/index.ts)
  - Shared types: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)
- The Leon preset has configuration-controlled automatic memory:
  - `automaticRecall: true`, `recallLimit: 4`, `recallMaxChars: 4000`, and deterministic final-ranking weights in [`apps/cli/config/agent-presets/leon/agent.cordis.yml`](../../apps/cli/config/agent-presets/leon/agent.cordis.yml)

## 2) Current test coverage

- Current count: **9 `.spec.ts` files** and **128 runtime cases** in memory scope, plus the browser-component cases for the review panel.
- Covered ranges:
  - Provider selection, content normalization, telemetry, and central validation in `memory.spec.ts`.
  - Local isolation, durability, revision handling, blocked-event telemetry, semantic configuration bounds, lexical fallback, and same-meaning recall in the two `memory-local` suites.
  - Real Loader composition for both review-only candidate extraction and opt-in hybrid semantic retrieval.
  - Explicit operations, read-only automatic recall, shadow candidate persistence, and sensitive-data blocking in the real agent flow.
  - Deterministic policy decisions, including block, reject, confirm, and store paths.
- Identified gaps:
  - There is no dedicated LEON-EVAL suite covering long-duration regression, performance, and generated cross-scope security scenarios.
  - There is no executable LEON-EVAL-PTBR scenario suite yet.

## 3) Difference between the current state and Memory V2

- Already implemented:
  - Explicit workspace-scoped memory through `memory_*` tools.
  - Basic protection against explicit credentials through `MEMORY_SENSITIVE_CONTENT`.
  - Read-only automatic snapshot retrieval through `agent/pre-step`.
  - Opt-in local shadow extraction of explicit or stable human-authored statements, without durable memory writes.
  - Shadow candidate persistence in `memory_candidate.candidates` with confidence, score, insertion, and sensitive-omission metadata.
  - Deterministic extracted-candidate policy covering `block`, `reject`, `shadow`, `confirm`, and review-only `store`, with `policyVersion`, `policyDecision`, and `policyReason` traceability.
  - Review vocabulary and durable review fields, including `reviewed`, `reviewDecision`, `reviewedAt`, and `reviewedBy`.
  - A session-header review panel that lists only the current workspace partition and records immutable accept or reject decisions without writing final memory.
  - A browser-safe Remote projection that omits internal workspace and owner identifiers.
  - Controlled final writes after explicit operator approval, gated by a master switch plus exact user and workspace allowlists, with durable `skipped`, `writing`, `stored`, or `failed` trace state.
  - Optional local hybrid semantic retrieval through loopback-only Ollama and `nomic-embed-text:latest`, with workspace filtering before embedding, a bounded ephemeral cache, content-free metrics, and deterministic lexical fallback.
  - One deterministic final rank for explicit search and automatic recall, with provider-output validation, id deduplication, configurable relevance, recency, importance and confirmation weights, bounded over-fetching, and provider-score rollback.
  - A safe automatic context composer with workspace and sensitive-content revalidation, id deduplication, source labels, a hard character budget, and `instructionAuthority: none`.
  - Schema V2 temporal lineage with activation, expiry, `supersedes`, `supersededBy`, active-only default retrieval, explicit audit history, atomic local revision preservation, and `historyMode: v1` rollback.
  - Workspace isolation and revision checks for correction and forgetting.
- Not yet implemented for V2:
  - A settings UI for changing automatic-write allowlists; the shipped Host composition remains off by default.
  - Exact tokenizer-based accounting across a full session; the current automatic snapshot uses a deterministic hard character budget.
  - The executable LEON-EVAL-PTBR suite.

## 4) Existing dependencies that must remain contractual

- `@deepseek-ai/dsh-tool-memory` declares `@deepseek-ai/dsh-memory` as a peer contract and consumes the provider-neutral `ctx.memory` seam.
- `@deepseek-ai/dsh-memory-local` uses `ctx.storageDomain` for durable local state.
- The Leon preset must keep memory optional so a headless profile without memory remains valid.
- Gemini keys were not changed in this baseline and must not be adjusted in this stage.

## 5) Current baseline risks

- The nine focused memory suites pass on Windows without environment-specific preconditions.
- The repository-wide `check:all` gate also passes on Windows; future Memory V2 phases must keep both focused and global coverage green.

## 6) V2 milestone deliverables

1. Consolidated target architecture document: complete.
2. Event layer and deterministic decision policy: initial implementation complete.
3. Shadow mode and human approval: local extraction, telemetry, review fields, and the operator decision UI are complete; final-memory writes remain intentionally disabled.
4. Hybrid retrieval, safe context composition, and temporal history: implemented; semantic retrieval remains behind an off-by-default switch pending evaluation.
5. LEON-EVAL-PTBR with objective criteria: specification exists; executable suite remains pending.
6. Reversible migration and rollback plans: documented.
