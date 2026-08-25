# Agent Note: Local shadow extraction of memory candidates

Status: implemented

English | [中文](2026-08-22-shadow-memory-candidate-extraction.zh.md)

## Problem

Explicit memory tools preserve user control but provide no evidence about which conversational facts Leon could safely suggest for later retention. Extracting every turn through an LLM or writing inferred facts immediately would add cost, nondeterminism, and privacy risk before a human review path exists.

## Decision

- `shadowExtraction` is an opt-in mode on `@deepseek-ai/dsh-tool-memory` and requires a stable `shadowOwnerId`. The Leon preset enables it for its single-user local deployment; multi-user deployments must provide their own owner boundary or leave it disabled.
- Only the latest human-authored message on the first accepted step is inspected. Conservative deterministic patterns recognize explicit remember requests and stable preference, decision, and configuration statements. Ordinary questions and later tool-loop steps create no candidate.
- Each safe candidate is stored only in the local `memory_candidate.candidates` review queue with workspace, session, owner, category, confidence, importance, and sensitivity metadata. The runtime `memory/candidate` event contains only metadata, never candidate text.
- Credential-like candidates are marked blocked and their text is omitted before persistence. Other sensitive topics are marked for confirmation.
- Shadow extraction never calls `ctx.memory.create()`, injects no model context, and exposes no tool result. Durable memory changes remain explicit through `memory_remember` until a later reviewed policy authorizes another path.

## Verification

Unit coverage pins PT-BR explicit extraction, stable-decision extraction, ordinary-question rejection, categorization, and credential omission. A real agent-loop integration proves that safe text lands only in the local shadow queue, owner and workspace metadata are present, runtime events contain no text, credential text is absent from storage, and `ctx.memory` remains unchanged. A real Loader composition boots the same Cordis config path and pins the durable candidate without a memory write.

## Alternatives considered

**Use an LLM to extract every turn.** Rejected because it would send more conversation content through a model, add provider cost, and make the first review dataset nondeterministic.

**Write high-confidence candidates directly to durable memory.** Rejected because confidence is not user authorization and the operator review surface is not yet shipped.

**Keep only the existing recall telemetry.** Rejected because retrieval counts cannot show which new stable fact the extractor would have proposed, so they cannot support meaningful human comparison.

## Consequences

Leon now produces a local, reviewable dataset for tuning memory policy without learning silently or increasing model-token usage. The initial extractor intentionally misses paraphrases and complex implicit facts; improving recall is less important than avoiding false retention at this phase. Shadow rows contain safe candidate text in the local storage backend, so backup and future review controls must preserve the same local access boundary.
