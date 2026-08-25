# Agent Note: Controlled automatic recall for Leon

Status: implemented

English | [中文](2026-08-22-controlled-automatic-memory-recall.zh.md)

## Problem

Explicit `memory_search` is safe but depends on the model remembering to call it. Leon needs useful continuity without copying full conversations into durable storage, leaking facts across workspaces, exposing stored credentials to a remote model, or allowing retained text to become hidden instructions.

## Decision

- **Recall is opt-in configuration on the existing Consumer.** `automaticRecall` leaves the provider contract and four tool names unchanged. The Leon preset enables it with a four-record and 4,000-character bound; other presets retain explicit-only behavior.
- **Only the first accepted step of a turn recalls.** Human-authored text in that step becomes a bounded provider query. Tool results, plugin context, and model text never become the query. Later tool-loop steps do not duplicate the snapshot.
- **Workspace resolution remains authoritative.** The agent session cwd resolves through `ctx.workspaceRegistry`; an absent or unregistered workspace produces no recall. The model still never chooses a scope or sees a workspace id or raw path.
- **Recalled content is durable, bounded, and untrusted.** Safe hits are encoded as quoted JSON in a source-attributed plugin snapshot immediately before the current human message. The static policy and snapshot both state that record values are data rather than instructions. Records that would cross the character bound are skipped, never truncated into ambiguous fragments.
- **Automatic recall is read-only and fail-open.** It performs no create, update, forget, extraction, summarization, or conversation capture. Cancellation suppresses the snapshot. Provider failure is logged and the model turn continues without optional memory.
- **Credential filtering is enforced at the model-facing boundary.** Common private-key, API-key, token, JWT, password-label, and credential patterns reject `memory_remember` and `memory_update`. Both explicit search and automatic recall omit matching stored records. This is conservative defense in depth, not a promise to recognize every secret format.
- **Candidate telemetry never retains query content.** Runtime events and durable shadow rows record the query length, candidate counts, scores, and policy outcome, but never the transient query text. Blocked and confirmation-required decisions follow the same rule because detection cannot guarantee that every secret format is recognized.

## Verification

A real agent-loop integration seeds safe, credential-like, and different-workspace records. It proves that the first request contains one safe untrusted snapshot, excludes secrets, workspace ids, paths, and the other workspace, and does not inject again during the tool loop. The explicit search result reports one withheld sensitive hit. The raw store remains unchanged, proving recall did not write. A second integration proves credential-like `memory_remember` fails before provider persistence. Candidate telemetry coverage proves that neither runtime events nor durable rows contain a raw query, including a policy-blocked credential-like query.

## Alternatives considered

- **Require explicit `memory_search` forever** — rejected because safe records would remain invisible whenever a model failed to choose the tool, weakening continuity for ordinary follow-up questions.
- **Automatically extract and retain every conversation turn** — rejected because recall does not grant authority to create durable facts. Automatic writes would create separate consent, correction, deletion, and privacy problems.
- **Place recalled records directly in the system prompt** — rejected because retained user data must not gain instruction priority. A source-attributed untrusted snapshot keeps policy and data visibly separate in the durable log.

## Consequences

Leon now recalls relevant project facts without requiring a tool call on every turn while retaining explicit writes and exact-revision corrections. Dynamic recall consumes bounded suffix tokens and lexical retrieval can miss paraphrases; richer retrieval remains a provider concern. Stored text is not granted instruction authority. Automatic durable writes, global memory, cross-workspace recall, and unsupervised learning remain out of scope; the separate [shadow extractor](../feature/2026-08-22-shadow-memory-candidate-extraction.md) creates review candidates without changing memory.
