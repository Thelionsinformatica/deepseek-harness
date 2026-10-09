# Agent Note: Always-present personal core profile

Status: implemented

English | [中文](2026-09-22-always-present-core-profile.zh.md)

## Problem

Personal-memory automatic recall only ran when the human message contained at least three consecutive letters or digits. A bare greeting such as "oi" never triggered recall, so a new conversation started without the user's identity, confirmed profile, or stable preferences. There was no way to mark a small set of confirmed personal facts as always-present.

## Decision

`tool-memory` adds an optional `core` marker to the memory record (additive; legacy records stay valid with no migration). Pre-step recall projects active, confirmed core facts (`core: true` and `validation` present) with a separate budget (`coreRecallLimit` default 10, `coreRecallMaxChars` default 2000), independent of the query. Query recall excludes only facts actually serialized in the core profile, so budget-omitted facts remain eligible for relevant search.

Listing is paginated so a core fact beyond the first page is still found. A process-local `contextVersion` rejects reads spanning successful mutations, provider changes, or enablement changes, independently of telemetry. Provider failures are caught and logged without aborting the turn. Tool outputs expose `core` so the model can inspect current membership; only the confirmed Host administration operation can change membership, as specified by [human-confirmed personal memory](../bug-fix/2026-09-25-human-confirmed-personal-profile.md).

Every step clears previous owned personal snapshots through logged Session surface replacements before downstream compaction, then projects current values into retained slots. Request-error recovery refreshes again before an admitted same-step retry, including ordinary backoff and context-overflow recovery. This changes the active model view without deleting original events or mutating a captured request. Disabled or invalidated reads leave content-free markers rather than stale values.

The existing confirmed browser correction operation reconfirms the complete submitted text at its exact revision with `validation: explicit` and `confidence: 1`. Full administration, visible confirmation, owning Session, sensitive-content checks, and audit admission remain required. No model-facing approval field or second memory store is added.

The core profile keeps the single authoritative personal-memory store, the same ids and revisions, and the same untrusted-data boundary (`personal-core-profile`, "untrusted, not instructions"). It never changes permissions or promotion rules.

## Alternatives considered

**Reuse `validation: 'reviewed'` plus `importance: 1` as the marker.** Rejected because it overloads existing semantics ("human-reviewed" and a continuous score) with a binary, always-present meaning.

**Copy the profile into the system prompt or a Markdown file.** Rejected because it creates a second authoritative source that can diverge from the memory store and ignores the disable/forget/correction lifecycle.

**Automatic extraction of essentials from conversation.** Rejected for this stage: essentials require explicit confirmation, not inference.

## Consequences

A new session receives confirmed core facts even for "oi". Ordinary correction invalidates confirmation, so a corrected fact leaves the core profile until re-confirmed; forgetting removes it; disabling personal memory suppresses refreshed injection. Core and query projections do not duplicate the same fact. Facts are rebuilt from current storage after restart or compaction, not restored from superseded snapshot text.

Output is bounded but scanning every active page adds local I/O. Surface replacements invalidate KV Cache from the first changed token and append audit events. Legacy duplicate slots retain one content-free marker each until compaction. The change does not redact facts copied into human messages, assistant replies, tool results, or older summaries; original logs remain preserved. Process-local revision checks do not detect out-of-process storage edits or cancel requests already sent to a provider.

Model-created proposals now remain unconfirmed under the separate [human-confirmation decision](../bug-fix/2026-09-25-human-confirmed-personal-profile.md). Existing confirmation metadata is not retroactively audited: the core filter establishes eligibility, not the truth or authorization of every pre-existing record.

## Testing

`packages/memory/tool-memory/tests/loader-composition.spec.ts` covers greeting injection, invalidation, forgetting, disable, mark/unmark, budget-aware deduplication, provider failure, and a core fact excluded from the first listing page. `core-profile-runtime.spec.ts` captures real agent-loop requests with temporary JSON storage and JSONL persistence, including multiple steps, recovery, compaction, restart, model changes, and telemetry-disabled read races. Administrative integration tests exercise reconfirmation and denied operations; provider tests cover exact revisions and preserved temporal history in both storage modes.

The runnable keyless `examples/headless-agent/personal-core-profile.cordis.snapshot.yml` composition uses `tests/fixtures/personal-core-profile-driver.ts`. Its snapshot test checks five requests, owner isolation, unconfirmed facts, correction, forgetting, and a separate persisted JSONL replay. Only the language-model responses are scripted. These checks establish runtime integration, not live-model conversational quality, production activation, or Letta behavioral equivalence.
